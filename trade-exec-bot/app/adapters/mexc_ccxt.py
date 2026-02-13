from __future__ import annotations

from decimal import Decimal
from typing import Any

import ccxt  # type: ignore

from .base import ExchangeAdapter


def _to_ccxt_symbol(symbol: str) -> str:
    raw = str(symbol or "").strip().upper()
    if "/" in raw:
        return raw
    if raw.endswith("USDC"):
        return f"{raw[:-4]}/USDC"
    if raw.endswith("USDT"):
        return f"{raw[:-4]}/USDT"
    return raw


class MexcCcxtAdapter(ExchangeAdapter):
    def __init__(
        self,
        api_key: str,
        api_secret: str,
        password: str = "",
        sandbox: bool = False,
    ):
        self.exchange = ccxt.mexc(
            {
                "apiKey": api_key,
                "secret": api_secret,
                "password": password or None,
                "enableRateLimit": True,
                "options": {"defaultType": "spot"},
            }
        )
        if sandbox:
            self.exchange.set_sandbox_mode(True)
        self.exchange.load_markets()

    def load_market(self, symbol: str) -> dict[str, Any]:
        market = self.exchange.market(_to_ccxt_symbol(symbol))
        if not market:
            raise ValueError(f"Market not found for symbol: {symbol}")
        return market

    def fetch_balance(self) -> dict[str, Any]:
        return self.exchange.fetch_balance()

    def fetch_ticker(self, symbol: str) -> dict[str, Any]:
        return self.exchange.fetch_ticker(_to_ccxt_symbol(symbol))

    def fetch_open_orders(self, symbol: str) -> list[dict[str, Any]]:
        return self.exchange.fetch_open_orders(_to_ccxt_symbol(symbol))

    def create_entry_order(
        self,
        symbol: str,
        side: str,
        order_type: str,
        qty: float,
        price: float | None = None,
    ) -> dict[str, Any]:
        ccxt_symbol = _to_ccxt_symbol(symbol)
        order_type = str(order_type or "market").lower()
        normalized_side = str(side).lower()
        if order_type == "limit":
            if price is None:
                raise ValueError("Limit orders require price")
            return self.exchange.create_order(ccxt_symbol, "limit", normalized_side, qty, price)
        return self.exchange.create_order(ccxt_symbol, "market", normalized_side, qty, None)

    def create_protection_orders(
        self,
        symbol: str,
        side: str,
        qty: float,
        sl_price: float | None,
        tp_price: float | None,
    ) -> dict[str, Any]:
        ccxt_symbol = _to_ccxt_symbol(symbol)
        market = self.exchange.market(ccxt_symbol)
        market_id = market.get("id") or ccxt_symbol.replace("/", "")
        protective_side = "sell" if str(side).lower() == "buy" else "buy"

        result: dict[str, Any] = {"tp": None, "sl": None, "errors": []}
        amount_precise = self.exchange.amount_to_precision(ccxt_symbol, qty)

        # First try exchange-specific OCO endpoints if exposed by CCXT implicit API.
        if tp_price and sl_price:
            candidate_methods = [
                "spotPrivatePostOrderOco",
                "privatePostOrderOco",
                "spot2PrivatePostOrderOco",
            ]
            for method_name in candidate_methods:
                method = getattr(self.exchange, method_name, None)
                if not callable(method):
                    continue
                try:
                    payload = {
                        "symbol": market_id,
                        "side": protective_side.upper(),
                        "quantity": amount_precise,
                        "price": self.exchange.price_to_precision(ccxt_symbol, tp_price),
                        "stopPrice": self.exchange.price_to_precision(ccxt_symbol, sl_price),
                        "stopLimitPrice": self.exchange.price_to_precision(ccxt_symbol, sl_price),
                        "stopLimitTimeInForce": "GTC",
                    }
                    oco = method(payload)
                    result["tp"] = {"status": "submitted", "method": "oco", "raw": oco}
                    result["sl"] = {"status": "submitted", "method": "oco", "raw": oco}
                    return result
                except Exception as exc:  # pragma: no cover - adapter fallback path
                    result["errors"].append(f"{method_name}: {exc}")

        # Fallback: place TP and SL as separate trigger/limit orders.
        if tp_price:
            try:
                tp_order = self.exchange.create_order(
                    ccxt_symbol,
                    "limit",
                    protective_side,
                    qty,
                    tp_price,
                    {"reduceOnly": True},
                )
                result["tp"] = {
                    "status": "submitted",
                    "method": "separate",
                    "orderId": tp_order.get("id"),
                    "price": float(Decimal(str(tp_price))),
                    "raw": tp_order,
                }
            except Exception as exc:  # pragma: no cover - exchange behavior dependent
                result["errors"].append(f"tp_separate: {exc}")
                result["tp"] = {"status": "failed", "price": tp_price, "error": str(exc)}

        if sl_price:
            stop_types = ["stop_loss_limit", "stop", "limit"]
            sl_error: Exception | None = None
            sl_order = None
            for stop_type in stop_types:
                try:
                    params = {"stopPrice": sl_price, "reduceOnly": True}
                    sl_order = self.exchange.create_order(
                        ccxt_symbol,
                        stop_type,
                        protective_side,
                        qty,
                        sl_price,
                        params,
                    )
                    break
                except Exception as exc:  # pragma: no cover - exchange behavior dependent
                    sl_error = exc
                    continue

            if sl_order:
                result["sl"] = {
                    "status": "submitted",
                    "method": "separate",
                    "orderId": sl_order.get("id"),
                    "price": float(Decimal(str(sl_price))),
                    "raw": sl_order,
                }
            else:
                msg = str(sl_error) if sl_error else "SL placement failed"
                result["errors"].append(f"sl_separate: {msg}")
                result["sl"] = {"status": "failed", "price": sl_price, "error": msg}

        return result
