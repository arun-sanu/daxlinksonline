import time
import uuid
from typing import Any

from .models import NormalizedSignal


def _normalize_symbol(symbol: str | None) -> str:
    raw = str(symbol or "").strip().upper()
    if not raw:
        return raw
    if "/" in raw:
        base, quote = raw.split("/", 1)
        return f"{base.strip()}/{quote.strip()}"
    # Fallback for compact symbols commonly used by exchange APIs.
    if raw.endswith("USDC"):
        return f"{raw[:-4]}/USDC"
    if raw.endswith("USDT"):
        return f"{raw[:-4]}/USDT"
    return raw


def _normalize_side(value: Any) -> str:
    side = str(value or "").strip().lower()
    if side in {"buy", "long", "entry_long", "bull"}:
        return "buy"
    if side in {"sell", "short", "entry_short", "bear"}:
        return "sell"
    return side


def _infer_order_type(value: Any, price: Any) -> str:
    order_type = str(value or "").strip().lower()
    if order_type in {"market", "limit"}:
        return order_type
    return "limit" if price not in (None, "", 0, "0") else "market"


def _as_float(value: Any, fallback: float | None = None) -> float | None:
    if value in (None, ""):
        return fallback
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return parsed


def _map_risk(payload: dict[str, Any]) -> dict[str, Any]:
    risk = payload.get("risk")
    if isinstance(risk, dict):
        return {
            "mode": str(risk.get("mode") or "balance_pct").lower(),
            "value": _as_float(risk.get("value"), 1.0),
            "min_quote_spend": _as_float(risk.get("min_quote_spend"), 1.05),
            "max_quote_spend": _as_float(risk.get("max_quote_spend"), 50.0),
        }

    risk_pct = _as_float(payload.get("riskPct") or payload.get("risk_percent"))
    fixed_quote = _as_float(payload.get("quoteSpend") or payload.get("amount"))
    if risk_pct and risk_pct > 0:
        mode = "balance_pct"
        value = risk_pct
    elif fixed_quote and fixed_quote > 0:
        mode = "fixed_quote"
        value = fixed_quote
    else:
        mode = "balance_pct"
        value = 1.0
    return {
        "mode": mode,
        "value": value,
        "min_quote_spend": _as_float(payload.get("minQuoteSpend"), 1.05),
        "max_quote_spend": _as_float(payload.get("maxQuoteSpend"), 50.0),
    }


def _map_stop(payload: dict[str, Any], key: str) -> dict[str, Any]:
    stop = payload.get(key)
    if isinstance(stop, dict):
        return {
            "type": str(stop.get("type") or "none").lower(),
            "value": _as_float(stop.get("value")),
        }

    if key == "sl":
        fallback = payload.get("stopLoss") or payload.get("stop_loss")
    else:
        fallback = payload.get("takeProfit") or payload.get("take_profit")
    if fallback is None:
        return {"type": "none", "value": None}
    return {"type": "percent", "value": _as_float(fallback)}


def map_incoming_payload_to_signal(payload: dict[str, Any]) -> NormalizedSignal:
    """
    Accepts:
    1) normalized DaxLinks payload
    2) older TradingView-style payloads and maps into normalized shape.
    """

    signal_id = (
        payload.get("id")
        or payload.get("signalId")
        or payload.get("alertId")
        or payload.get("signal_id")
        or str(uuid.uuid4())
    )

    symbol = _normalize_symbol(
        payload.get("symbol")
        or payload.get("ticker")
        or payload.get("pair")
        or payload.get("market")
    )
    side = _normalize_side(payload.get("side") or payload.get("signal") or payload.get("action"))

    order = payload.get("order") if isinstance(payload.get("order"), dict) else {}
    limit_price = (
        order.get("limit_price")
        if order
        else payload.get("limit_price") or payload.get("limitPrice") or payload.get("price")
    )
    order_type = _infer_order_type(order.get("type") if order else payload.get("orderType"), limit_price)

    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}

    normalized = {
        "id": str(signal_id),
        "symbol": symbol,
        "side": side,
        "order": {
            "type": order_type,
            "limit_price": _as_float(limit_price),
        },
        "risk": _map_risk(payload),
        "sl": _map_stop(payload, "sl"),
        "tp": _map_stop(payload, "tp"),
        "meta": {
            "strategy": meta.get("strategy") or payload.get("strategyName") or payload.get("strategy"),
            "timeframe": meta.get("timeframe") or payload.get("timeframe"),
            "source": meta.get("source") or payload.get("source") or "tradingview",
            "workspaceId": meta.get("workspaceId") or payload.get("workspaceId"),
            "botId": meta.get("botId") or payload.get("botId"),
            "botInstanceId": meta.get("botInstanceId") or payload.get("botInstanceId"),
        },
        "timestamp": int(payload.get("timestamp") or payload.get("tvTs") or time.time()),
        "signal_price": _as_float(payload.get("signal_price") or payload.get("price")),
    }

    return NormalizedSignal.model_validate(normalized)
