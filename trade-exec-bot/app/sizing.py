from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_DOWN
from typing import Any

from .models import NormalizedSignal


def _to_decimal(value: Any, fallback: Decimal | None = None) -> Decimal | None:
    if value in (None, ""):
        return fallback
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return fallback


def _clamp(value: Decimal, min_value: Decimal, max_value: Decimal) -> Decimal:
    return max(min_value, min(max_value, value))


def _asset_free(balance: dict[str, Any], asset: str) -> Decimal:
    asset_key = asset.upper()
    total = balance.get("total") if isinstance(balance, dict) else None
    if isinstance(total, dict) and asset_key in total:
        value = total[asset_key]
        return _to_decimal(value, Decimal("0")) or Decimal("0")

    # CCXT uses per-asset dictionaries with free/used/total in many exchanges.
    row = balance.get(asset_key) if isinstance(balance, dict) else None
    if isinstance(row, dict):
        return _to_decimal(row.get("free"), Decimal("0")) or Decimal("0")

    # Fallback for exchanges that return `balances: [{asset, free}]`.
    balances = balance.get("balances") if isinstance(balance, dict) else None
    if isinstance(balances, list):
        for item in balances:
            if str(item.get("asset", "")).upper() == asset_key:
                return _to_decimal(item.get("free"), Decimal("0")) or Decimal("0")
    return Decimal("0")


def split_symbol(symbol: str) -> tuple[str, str]:
    normalized = str(symbol or "").upper().strip()
    if "/" in normalized:
        base, quote = normalized.split("/", 1)
        return base, quote
    if normalized.endswith("USDC"):
        return normalized[:-4], "USDC"
    if normalized.endswith("USDT"):
        return normalized[:-4], "USDT"
    raise ValueError(f"Unsupported symbol format: {symbol}")


def _infer_step_size(market: dict[str, Any], precision_amount: int | None) -> Decimal | None:
    info = market.get("info") if isinstance(market, dict) else {}
    for key in ("baseSizePrecision", "stepSize", "baseIncrement", "quantityScale"):
        value = _to_decimal(info.get(key))
        if value and value > 0:
            # quantityScale can be integer decimals.
            if key == "quantityScale" and value >= 1:
                return Decimal(1) / (Decimal(10) ** int(value))
            return value

    limits = market.get("limits") if isinstance(market, dict) else {}
    limit_amount = (limits.get("amount") or {}) if isinstance(limits, dict) else {}
    min_amount = _to_decimal(limit_amount.get("min"))
    if min_amount and min_amount > 0:
        return min_amount

    if precision_amount is not None and precision_amount >= 0:
        return Decimal(1) / (Decimal(10) ** precision_amount)
    return None


def _round_down_to_market_rules(
    qty: Decimal,
    step_size: Decimal | None,
    precision_amount: int | None,
) -> Decimal:
    out = qty
    if step_size and step_size > 0:
        out = (out // step_size) * step_size
    if precision_amount is not None and precision_amount >= 0:
        quant = Decimal(1) / (Decimal(10) ** precision_amount)
        out = out.quantize(quant, rounding=ROUND_DOWN)
    return out


@dataclass
class SizingComputation:
    free_quote: Decimal
    free_base: Decimal
    quote_spend: Decimal
    qty_raw: Decimal
    qty_final: Decimal
    ref_price: Decimal
    exchange_min_notional: Decimal
    effective_min_notional: Decimal
    precision_amount: int | None
    step_size: Decimal | None


class SizingError(Exception):
    def __init__(self, message: str, reason: str, partial: SizingComputation | None = None):
        super().__init__(message)
        self.reason = reason
        self.partial = partial


def compute_sizing(
    signal: NormalizedSignal,
    balance: dict[str, Any],
    market: dict[str, Any],
    ticker_last: float | int | str | None,
) -> SizingComputation:
    base_asset, quote_asset = split_symbol(signal.symbol)
    free_quote = _asset_free(balance, quote_asset)
    free_base = _asset_free(balance, base_asset)

    risk_mode = signal.risk.mode
    risk_value = _to_decimal(signal.risk.value, Decimal("0")) or Decimal("0")
    min_quote_spend = _to_decimal(signal.risk.min_quote_spend, Decimal("0")) or Decimal("0")
    max_quote_spend = _to_decimal(signal.risk.max_quote_spend, Decimal("0")) or Decimal("0")

    if risk_mode == "balance_pct":
        quote_spend = free_quote * (risk_value / Decimal("100"))
    elif risk_mode == "fixed_quote":
        quote_spend = risk_value
    else:
        raise SizingError(f"Unsupported risk.mode: {risk_mode}", "invalid_risk_mode")

    if max_quote_spend <= 0:
        max_quote_spend = quote_spend if quote_spend > 0 else min_quote_spend
    quote_spend = _clamp(quote_spend, min_quote_spend, max_quote_spend)

    ref_price = _to_decimal(signal.signal_price, None) or _to_decimal(ticker_last, None)
    if not ref_price or ref_price <= 0:
        raise SizingError("Missing valid reference price", "invalid_ref_price")

    qty_raw = quote_spend / ref_price
    limits = market.get("limits") if isinstance(market, dict) else {}
    cost_limits = (limits.get("cost") or {}) if isinstance(limits, dict) else {}
    exchange_min_notional = _to_decimal(cost_limits.get("min"), Decimal("0")) or Decimal("0")

    precision = market.get("precision") if isinstance(market, dict) else {}
    precision_amount = precision.get("amount") if isinstance(precision, dict) else None
    if precision_amount is not None:
        try:
            precision_amount = int(precision_amount)
        except (TypeError, ValueError):
            precision_amount = None

    step_size = _infer_step_size(market, precision_amount)
    qty_final = _round_down_to_market_rules(qty_raw, step_size, precision_amount)
    effective_min_notional = max(exchange_min_notional, min_quote_spend)

    partial = SizingComputation(
        free_quote=free_quote,
        free_base=free_base,
        quote_spend=quote_spend,
        qty_raw=qty_raw,
        qty_final=qty_final,
        ref_price=ref_price,
        exchange_min_notional=exchange_min_notional,
        effective_min_notional=effective_min_notional,
        precision_amount=precision_amount,
        step_size=step_size,
    )

    if qty_final <= 0:
        raise SizingError("Quantity became zero after rounding", "qty_zero_after_rounding", partial=partial)

    if (qty_final * ref_price) < effective_min_notional:
        raise SizingError("Notional after rounding is below minimum", "below_min_notional", partial=partial)

    return partial


def sizing_to_dict(signal: NormalizedSignal, comp: SizingComputation, status: str, reject_reason: str | None = None) -> dict[str, Any]:
    return {
        "mode": signal.risk.mode,
        "riskMode": signal.risk.mode,
        "riskValue": float(signal.risk.value),
        "freeQuote": float(comp.free_quote),
        "freeBase": float(comp.free_base),
        "quoteSpend": float(comp.quote_spend),
        "qtyRaw": float(comp.qty_raw),
        "qtyFinal": float(comp.qty_final),
        "refPrice": float(comp.ref_price),
        "exchangeMinNotional": float(comp.exchange_min_notional),
        "effectiveMinNotional": float(comp.effective_min_notional),
        "precisionAmount": comp.precision_amount,
        "stepSize": float(comp.step_size) if comp.step_size is not None else None,
        "roundingMethod": "floor",
        "status": status,
        "rejectReason": reject_reason,
    }
