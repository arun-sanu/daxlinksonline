from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

from .config import Settings
from .daxlinks_client import DaxLinksClient
from .logger import log_event
from .mapper import map_incoming_payload_to_signal
from .models import ExecutionResponse, NormalizedSignal, ProtectionResult
from .risk import RiskGuard
from .sizing import SizingComputation, SizingError, compute_sizing, sizing_to_dict


def _to_float(value: Any, fallback: float | None = None) -> float | None:
    if value in (None, ""):
        return fallback
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _normalize_status(value: Any) -> str:
    normalized = str(value or "").lower().strip()
    if normalized in {"closed", "filled", "success", "executed"}:
        return "filled"
    if normalized in {"rejected", "failed", "canceled", "cancelled", "error"}:
        return "rejected"
    if normalized:
        return normalized
    return "submitted"


def _base_entry_order(signal: NormalizedSignal) -> dict[str, Any]:
    return {
        "venue": "mexc",
        "symbol": signal.symbol,
        "side": signal.side.upper(),
        "type": signal.order.type.upper(),
        "qty": 0.0,
        "price": signal.signal_price,
        "status": "submitted",
        "venueOrderId": None,
    }


def _compute_sl_price(signal: NormalizedSignal, entry_price: Decimal) -> Decimal | None:
    sl_type = signal.sl.type
    sl_value = _to_float(signal.sl.value)
    if sl_type == "none" or sl_value is None:
        return None

    if sl_type == "percent":
        pct = Decimal(str(sl_value)) / Decimal("100")
        if signal.side == "buy":
            return entry_price * (Decimal("1") - pct)
        return entry_price * (Decimal("1") + pct)
    if sl_type == "absolute":
        return Decimal(str(sl_value))
    return None


def _compute_tp_price(
    signal: NormalizedSignal,
    entry_price: Decimal,
    sl_price: Decimal | None,
) -> Decimal | None:
    tp_type = signal.tp.type
    tp_value = _to_float(signal.tp.value)
    if tp_type == "none" or tp_value is None:
        return None

    if tp_type == "percent":
        pct = Decimal(str(tp_value)) / Decimal("100")
        if signal.side == "buy":
            return entry_price * (Decimal("1") + pct)
        return entry_price * (Decimal("1") - pct)

    if tp_type == "absolute":
        return Decimal(str(tp_value))

    if tp_type == "rr" and sl_price is not None:
        rr = Decimal(str(tp_value))
        risk_distance = abs(entry_price - sl_price)
        if signal.side == "buy":
            return entry_price + (risk_distance * rr)
        return entry_price - (risk_distance * rr)

    return None


class TradeExecutionEngine:
    def __init__(
        self,
        settings: Settings,
        adapter: Any,
        daxlinks_client: DaxLinksClient,
        risk_guard: RiskGuard,
        logger: logging.Logger,
    ):
        self.settings = settings
        self.adapter = adapter
        self.daxlinks_client = daxlinks_client
        self.risk_guard = risk_guard
        self.logger = logger

    def _post_result(
        self,
        signal: NormalizedSignal,
        raw_payload: dict[str, Any],
        entry_order: dict[str, Any],
        protection: dict[str, Any],
        sizing: dict[str, Any],
        errors: list[str],
    ) -> bool:
        payload = {
            "signalId": signal.id,
            "workspaceId": signal.meta.workspaceId or self.settings.daxlinks_workspace_id_fallback or None,
            "botId": signal.meta.botId or self.settings.daxlinks_bot_id_fallback or None,
            "botInstanceId": signal.meta.botInstanceId or self.settings.daxlinks_bot_instance_id_fallback or None,
            "normalizedSignal": signal.model_dump(),
            "entryOrder": entry_order,
            "protection": protection,
            "sizing": sizing,
            "errors": errors,
            "rawPayload": raw_payload,
        }
        self.daxlinks_client.post_order_result(payload)
        return True

    def _reject_with_reason(
        self,
        signal: NormalizedSignal,
        raw_payload: dict[str, Any],
        base_sizing: dict[str, Any],
        reject_reason: str,
        errors: list[str],
    ) -> dict[str, Any]:
        sizing = {
            **base_sizing,
            "status": "rejected",
            "rejectReason": reject_reason,
        }
        entry_order = {
            **_base_entry_order(signal),
            "status": "rejected",
            "error": reject_reason,
        }
        protection = {"tp": None, "sl": None}
        response = ExecutionResponse(
            ok=False,
            signalId=signal.id,
            entryOrder=entry_order,
            protection=ProtectionResult(tp=None, sl=None, errors=[]),
            sizing=sizing,
            errors=errors,
        ).model_dump()
        persisted = True
        try:
            self._post_result(signal, raw_payload, entry_order, protection, sizing, errors)
        except Exception as exc:
            persisted = False
            response["errors"].append(f"persist_failed: {exc}")
            log_event(
                self.logger,
                logging.ERROR,
                "persist_failed",
                signal_id=signal.id,
                error=str(exc),
            )
        response["ok"] = bool(response["ok"] and persisted)
        return response

    def process(self, raw_payload: dict[str, Any]) -> dict[str, Any]:
        signal = map_incoming_payload_to_signal(raw_payload)
        log_event(
            self.logger,
            logging.INFO,
            "signal_received",
            signal_id=signal.id,
            symbol=signal.symbol,
            side=signal.side,
            strategy=signal.meta.strategy,
        )

        errors: list[str] = []
        base_sizing = {
            "riskMode": signal.risk.mode,
            "riskValue": signal.risk.value,
            "status": "rejected",
            "rejectReason": None,
            "freeQuote": 0.0,
            "freeBase": 0.0,
            "quoteSpend": 0.0,
            "qtyRaw": 0.0,
            "qtyFinal": 0.0,
            "refPrice": signal.signal_price,
            "exchangeMinNotional": 0.0,
            "effectiveMinNotional": max(signal.risk.min_quote_spend, 0.0),
            "precisionAmount": None,
            "stepSize": None,
            "roundingMethod": "floor",
        }

        try:
            market = self.adapter.load_market(signal.symbol)
        except Exception as exc:
            errors.append(str(exc))
            return self._reject_with_reason(signal, raw_payload, base_sizing, "symbol_not_found", errors)

        try:
            balance = self.adapter.fetch_balance()
            ticker = self.adapter.fetch_ticker(signal.symbol)
            open_orders = self.adapter.fetch_open_orders(signal.symbol)
        except Exception as exc:
            errors.append(str(exc))
            return self._reject_with_reason(signal, raw_payload, base_sizing, "exchange_fetch_failed", errors)

        try:
            sizing_comp = compute_sizing(signal, balance, market, ticker.get("last"))
            sizing_dict = sizing_to_dict(signal, sizing_comp, status="ready", reject_reason=None)
        except SizingError as exc:
            partial = exc.partial
            if partial:
                sizing_dict = sizing_to_dict(signal, partial, status="rejected", reject_reason=exc.reason)
            else:
                sizing_dict = {**base_sizing, "status": "rejected", "rejectReason": exc.reason}
            errors.append(str(exc))
            return self._reject_with_reason(signal, raw_payload, sizing_dict, exc.reason, errors)

        risk_errors = self.risk_guard.check(signal, sizing_comp, open_orders)
        if risk_errors:
            reason, message = risk_errors[0]
            errors.extend([err[1] for err in risk_errors])
            return self._reject_with_reason(signal, raw_payload, sizing_dict, reason, errors + [message])

        qty = float(sizing_comp.qty_final)
        order_price = signal.order.limit_price if signal.order.type == "limit" else None

        entry_order = _base_entry_order(signal)
        entry_raw: dict[str, Any] | None = None
        try:
            entry_raw = self.adapter.create_entry_order(
                signal.symbol,
                signal.side,
                signal.order.type,
                qty,
                order_price,
            )
            entry_status = _normalize_status(entry_raw.get("status"))
            entry_order = {
                **entry_order,
                "qty": _to_float(entry_raw.get("amount"), qty) or qty,
                "price": _to_float(entry_raw.get("average"))
                or _to_float(entry_raw.get("price"))
                or float(sizing_comp.ref_price),
                "status": entry_status,
                "venueOrderId": str(entry_raw.get("id") or ""),
                "raw": entry_raw,
            }
            sizing_dict["status"] = entry_status
        except Exception as exc:
            errors.append(str(exc))
            sizing_dict["status"] = "error"
            entry_order = {
                **entry_order,
                "status": "error",
                "error": str(exc),
                "qty": qty,
                "price": float(sizing_comp.ref_price),
            }
            response = ExecutionResponse(
                ok=False,
                signalId=signal.id,
                entryOrder=entry_order,
                protection=ProtectionResult(tp=None, sl=None, errors=[]),
                sizing=sizing_dict,
                errors=errors,
            ).model_dump()
            persisted = True
            try:
                self._post_result(signal, raw_payload, entry_order, {"tp": None, "sl": None}, sizing_dict, errors)
            except Exception as persist_exc:
                persisted = False
                response["errors"].append(f"persist_failed: {persist_exc}")
            response["ok"] = bool(response["ok"] and persisted)
            return response

        entry_price_dec = Decimal(str(entry_order.get("price") or sizing_comp.ref_price))
        sl_price_dec = _compute_sl_price(signal, entry_price_dec)
        tp_price_dec = _compute_tp_price(signal, entry_price_dec, sl_price_dec)
        sizing_dict["slPrice"] = float(sl_price_dec) if sl_price_dec is not None else None
        sizing_dict["tpPrice"] = float(tp_price_dec) if tp_price_dec is not None else None

        protection_raw = {"tp": None, "sl": None}
        protection_errors: list[str] = []
        if sl_price_dec is not None or tp_price_dec is not None:
            try:
                protection_raw = self.adapter.create_protection_orders(
                    signal.symbol,
                    signal.side,
                    qty,
                    float(sl_price_dec) if sl_price_dec is not None else None,
                    float(tp_price_dec) if tp_price_dec is not None else None,
                )
                protection_errors.extend(protection_raw.get("errors") or [])
            except Exception as exc:
                protection_errors.append(str(exc))
                protection_raw = {
                    "tp": {"status": "failed", "error": str(exc)} if tp_price_dec is not None else None,
                    "sl": {"status": "failed", "error": str(exc)} if sl_price_dec is not None else None,
                    "errors": [str(exc)],
                }

        errors.extend(protection_errors)
        response = ExecutionResponse(
            ok=True,
            signalId=signal.id,
            entryOrder=entry_order,
            protection=ProtectionResult(
                tp=protection_raw.get("tp"),
                sl=protection_raw.get("sl"),
                errors=protection_raw.get("errors") or [],
            ),
            sizing=sizing_dict,
            errors=errors,
        ).model_dump()

        persisted = True
        try:
            self._post_result(signal, raw_payload, entry_order, protection_raw, sizing_dict, errors)
        except Exception as exc:
            persisted = False
            response["errors"].append(f"persist_failed: {exc}")
            log_event(self.logger, logging.ERROR, "persist_failed", signal_id=signal.id, error=str(exc))

        self.risk_guard.mark_trade(signal.symbol)
        response["ok"] = bool(response["ok"] and persisted)
        return response
