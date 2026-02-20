#!/usr/bin/env python3
"""
MEXC spot trading bot using MACD + Bollinger Bands strategy.

Setup:
1. Copy `python-bot/.env.example` to `python-bot/.env` and set values.
2. Install dependencies: `pip3 install -r python-bot/requirements.txt`.
3. Run manually: `cd python-bot && python3 mexc_bot.py`.
4. Or run with PM2 using `ecosystem.config.js` in project root.

The bot runs as a separate process and reports each executed order to:
POST /api/v1/internal/bot/order-result
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import signal
import sys
import time
from collections import deque
from dataclasses import dataclass
from logging.handlers import RotatingFileHandler
from typing import Any, Deque, Dict, List, Optional
from urllib.parse import urlencode

import aiohttp
import numpy as np


def load_dotenv_file(path: str = ".env") -> None:
    """Minimal .env loader to avoid extra dependencies."""
    if not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as env_file:
            for raw_line in env_file:
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip()
                if not key or key in os.environ:
                    continue
                if value and value[0] == value[-1] and value[0] in ('"', "'"):
                    value = value[1:-1]
                if " #" in value:
                    value = value.split(" #", 1)[0].rstrip()
                os.environ[key] = value
    except Exception:
        # Config validation will surface missing values later.
        pass


def parse_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def parse_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    try:
        return float(value)
    except ValueError as exc:
        raise ValueError(f"Invalid float for {name}: {value}") from exc


def parse_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"Invalid int for {name}: {value}") from exc


@dataclass
class BotConfig:
    mexc_api_key: str
    mexc_api_secret: str
    backend_url: str
    internal_bot_token: str

    bot_instance_id: str
    workspace_id: Optional[str]
    bot_id: Optional[str]

    symbol: str
    base_quantity: float

    macd_fast: int
    macd_slow: int
    macd_signal: int
    bb_length: int
    bb_mult: float
    stop_loss_pct: float
    risk_reward: int
    take_profit_mode: str
    trailing_take_profit_enabled: bool
    trailing_take_profit_pct: float
    trailing_take_profit_activation_pct: float

    check_interval: int
    log_level: str
    recv_window: int
    request_timeout: int

    allow_shorts: bool
    report_retries: int
    order_retries: int
    health_interval: int

    ws_url: str
    rest_base_url: str
    backend_runtime_path: str

    log_file: str
    resolve_exchange_from_backend: bool
    runtime_retries: int

    @classmethod
    def from_env(cls) -> "BotConfig":
        symbol = os.getenv("SYMBOL", "BTCUSDC").strip().upper().replace("/", "")
        bot_instance_id = os.getenv("BOT_INSTANCE_ID", "").strip()
        if not bot_instance_id:
            bot_instance_id = f"mexc-bot-{int(time.time())}"

        default_log_file = f"/var/log/mexc-bot-{bot_instance_id}.log"

        return cls(
            mexc_api_key=os.getenv("MEXC_API_KEY", "").strip(),
            mexc_api_secret=os.getenv("MEXC_API_SECRET", "").strip(),
            backend_url=os.getenv("BACKEND_URL", "http://localhost:8000").strip().rstrip("/"),
            internal_bot_token=os.getenv("INTERNAL_BOT_TOKEN", "").strip(),
            bot_instance_id=bot_instance_id,
            workspace_id=(os.getenv("WORKSPACE_ID", "").strip() or None),
            bot_id=(os.getenv("BOT_ID", "").strip() or None),
            symbol=symbol,
            base_quantity=parse_float("BASE_QUANTITY", 0.001),
            macd_fast=parse_int("MACD_FAST", 12),
            macd_slow=parse_int("MACD_SLOW", 26),
            macd_signal=parse_int("MACD_SIGNAL", 9),
            bb_length=parse_int("BB_LENGTH", 20),
            bb_mult=parse_float("BB_MULT", 2.0),
            stop_loss_pct=parse_float("STOP_LOSS_PCT", 2.0),
            risk_reward=parse_int("RISK_REWARD", 5),
            take_profit_mode=os.getenv("TP_TYPE", "fixed").strip().lower(),
            trailing_take_profit_enabled=parse_bool("TRAILING_TAKE_PROFIT_ENABLED", False),
            trailing_take_profit_pct=parse_float("TRAILING_TP_PCT", 1.0),
            trailing_take_profit_activation_pct=parse_float("TRAILING_TP_ACTIVATION_PCT", 0.0),
            check_interval=parse_int("CHECK_INTERVAL", 60),
            log_level=os.getenv("LOG_LEVEL", "INFO").strip().upper(),
            recv_window=parse_int("MEXC_RECV_WINDOW", 5000),
            request_timeout=parse_int("REQUEST_TIMEOUT", 20),
            allow_shorts=parse_bool("ALLOW_SHORTS", False),
            report_retries=parse_int("REPORT_RETRIES", 3),
            order_retries=parse_int("ORDER_RETRIES", 3),
            health_interval=parse_int("HEALTH_INTERVAL", 300),
            ws_url=os.getenv("MEXC_WS_URL", "wss://wbs.mexc.com/ws").strip(),
            rest_base_url=os.getenv("MEXC_REST_URL", "https://api.mexc.com").strip().rstrip("/"),
            backend_runtime_path=os.getenv("BACKEND_RUNTIME_PATH", "/api/v1/internal/bot/runtime-config").strip(),
            log_file=os.getenv("LOG_FILE", default_log_file).strip(),
            resolve_exchange_from_backend=parse_bool("RESOLVE_EXCHANGE_FROM_BACKEND", True),
            runtime_retries=parse_int("RUNTIME_RETRIES", 3),
        )

    def validate(self) -> None:
        if not self.internal_bot_token:
            raise ValueError("INTERNAL_BOT_TOKEN is required")
        if not self.bot_instance_id:
            raise ValueError("BOT_INSTANCE_ID is required")
        if not self.mexc_api_key or not self.mexc_api_secret:
            if not self.resolve_exchange_from_backend:
                raise ValueError(
                    "MEXC_API_KEY and MEXC_API_SECRET are required when RESOLVE_EXCHANGE_FROM_BACKEND is false"
                )
        if not self.symbol:
            raise ValueError("SYMBOL is required")
        if self.base_quantity <= 0:
            raise ValueError("BASE_QUANTITY must be > 0")
        if self.macd_fast <= 0 or self.macd_slow <= 0 or self.macd_signal <= 0:
            raise ValueError("MACD periods must be > 0")
        if self.macd_fast >= self.macd_slow:
            raise ValueError("MACD_FAST must be less than MACD_SLOW")
        if self.bb_length <= 1:
            raise ValueError("BB_LENGTH must be > 1")
        if self.bb_mult <= 0:
            raise ValueError("BB_MULT must be > 0")
        if self.stop_loss_pct <= 0:
            raise ValueError("STOP_LOSS_PCT must be > 0")
        if self.risk_reward < 1:
            raise ValueError("RISK_REWARD must be >= 1")
        if self.take_profit_mode not in {"fixed", "percent", "trailing"}:
            raise ValueError("TP_TYPE must be one of: fixed, percent, trailing")
        if self.trailing_take_profit_pct <= 0 and (
            self.take_profit_mode == "trailing" or self.trailing_take_profit_enabled
        ):
            raise ValueError("TRAILING_TP_PCT must be > 0")
        if self.trailing_take_profit_activation_pct < 0:
            raise ValueError("TRAILING_TP_ACTIVATION_PCT must be >= 0")
        if self.check_interval <= 0:
            raise ValueError("CHECK_INTERVAL must be > 0")
        if self.recv_window <= 0:
            raise ValueError("MEXC_RECV_WINDOW must be > 0")
        if self.request_timeout <= 0:
            raise ValueError("REQUEST_TIMEOUT must be > 0")
        if self.report_retries <= 0:
            raise ValueError("REPORT_RETRIES must be > 0")
        if self.order_retries <= 0:
            raise ValueError("ORDER_RETRIES must be > 0")
        if self.runtime_retries <= 0:
            raise ValueError("RUNTIME_RETRIES must be > 0")
        if not self.backend_runtime_path.startswith("/"):
            raise ValueError("BACKEND_RUNTIME_PATH must start with '/'")


@dataclass
class SignalSnapshot:
    action: str
    signal_price: float
    stop_loss: float
    take_profit: float
    indicators: Dict[str, float]


@dataclass
class PositionState:
    side: str = "FLAT"  # FLAT | LONG | SHORT
    quantity: float = 0.0
    entry_price: float = 0.0
    stop_loss: float = 0.0
    take_profit: float = 0.0
    opened_at_ms: int = 0
    trailing_active: bool = False
    trailing_anchor_price: float = 0.0
    trailing_stop_price: float = 0.0
    trailing_activation_price: float = 0.0


class MACDBollingerStrategy:
    """Pine strategy equivalent: MACD crossover + Bollinger middle filter."""

    def __init__(self, config: BotConfig, logger: logging.Logger):
        self.config = config
        self.logger = logger
        self.prices: Deque[float] = deque(maxlen=100)
        self.latest_price: Optional[float] = None

    def update_price(self, price: float) -> None:
        if not np.isfinite(price) or price <= 0:
            return
        value = float(price)
        self.latest_price = value
        self.prices.append(value)

    def _ema(self, values: np.ndarray, period: int) -> np.ndarray:
        ema = np.empty_like(values, dtype=float)
        alpha = 2.0 / (period + 1.0)
        ema[0] = values[0]
        for i in range(1, len(values)):
            ema[i] = alpha * values[i] + (1.0 - alpha) * ema[i - 1]
        return ema

    def _macd(self, values: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        ema_fast = self._ema(values, self.config.macd_fast)
        ema_slow = self._ema(values, self.config.macd_slow)
        macd_line = ema_fast - ema_slow
        signal_line = self._ema(macd_line, self.config.macd_signal)
        histogram = macd_line - signal_line
        return macd_line, signal_line, histogram

    def _bollinger_middle(self, values: np.ndarray) -> tuple[float, float, float]:
        recent = values[-self.config.bb_length :]
        basis = float(np.mean(recent))
        dev = float(self.config.bb_mult * np.std(recent, ddof=0))
        upper = basis + dev
        lower = basis - dev
        return upper, basis, lower

    def min_required_points(self) -> int:
        return max(self.config.bb_length + 2, self.config.macd_slow + self.config.macd_signal + 2)

    def compute_signal(self) -> Optional[SignalSnapshot]:
        if len(self.prices) < self.min_required_points():
            return None

        series = np.array(self.prices, dtype=float)
        macd_line, signal_line, _ = self._macd(series)
        _, bb_middle, _ = self._bollinger_middle(series)

        current_price = float(series[-1])
        prev_macd = float(macd_line[-2])
        prev_signal = float(signal_line[-2])
        curr_macd = float(macd_line[-1])
        curr_signal = float(signal_line[-1])

        macd_cross_up = prev_macd <= prev_signal and curr_macd > curr_signal
        macd_cross_down = prev_macd >= prev_signal and curr_macd < curr_signal

        long_condition = macd_cross_up and current_price > bb_middle
        short_condition = macd_cross_down and current_price < bb_middle

        if long_condition:
            stop_loss = current_price * (1.0 - (self.config.stop_loss_pct / 100.0))
            take_profit = current_price * (
                1.0 + ((self.config.stop_loss_pct / 100.0) * self.config.risk_reward)
            )
            return SignalSnapshot(
                action="BUY",
                signal_price=current_price,
                stop_loss=stop_loss,
                take_profit=take_profit,
                indicators={
                    "macd": curr_macd,
                    "signal": curr_signal,
                    "bb_middle": float(bb_middle),
                },
            )

        if short_condition:
            stop_loss = current_price * (1.0 + (self.config.stop_loss_pct / 100.0))
            take_profit = current_price * (
                1.0 - ((self.config.stop_loss_pct / 100.0) * self.config.risk_reward)
            )
            return SignalSnapshot(
                action="SELL",
                signal_price=current_price,
                stop_loss=stop_loss,
                take_profit=take_profit,
                indicators={
                    "macd": curr_macd,
                    "signal": curr_signal,
                    "bb_middle": float(bb_middle),
                },
            )

        return None


class MexcAPIError(Exception):
    pass


class MEXCClient:
    def __init__(self, config: BotConfig, logger: logging.Logger):
        self.config = config
        self.logger = logger
        self.session: Optional[aiohttp.ClientSession] = None

        self.symbol_filters: Dict[str, float] = {
            "step_size": 0.0,
            "min_qty": 0.0,
            "min_notional": 0.0,
        }

    async def start(self) -> None:
        if self.session and not self.session.closed:
            return
        timeout = aiohttp.ClientTimeout(total=self.config.request_timeout)
        self.session = aiohttp.ClientSession(timeout=timeout)

    async def close(self) -> None:
        if self.session and not self.session.closed:
            await self.session.close()

    def _signed_url(self, path: str, params: Dict[str, Any]) -> str:
        request_params = dict(params)
        request_params["timestamp"] = int(time.time() * 1000)
        request_params["recvWindow"] = self.config.recv_window

        query = urlencode(request_params)
        signature = hmac.new(
            self.config.mexc_api_secret.encode("utf-8"),
            query.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        return f"{self.config.rest_base_url}{path}?{query}&signature={signature}"

    async def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        *,
        signed: bool,
        retries: int,
    ) -> Dict[str, Any]:
        if not self.session or self.session.closed:
            await self.start()

        params = dict(params or {})
        delay = 1.0
        for attempt in range(1, retries + 1):
            try:
                if signed:
                    # Regenerate timestamp/signature for each retry attempt.
                    url = self._signed_url(path, params)
                    headers = {"X-MEXC-APIKEY": self.config.mexc_api_key}
                else:
                    query = urlencode(params)
                    url = f"{self.config.rest_base_url}{path}"
                    if query:
                        url = f"{url}?{query}"
                    headers = {}

                assert self.session is not None
                async with self.session.request(method.upper(), url, headers=headers) as resp:
                    text = await resp.text()
                    payload: Dict[str, Any]
                    try:
                        payload = json.loads(text) if text else {}
                    except json.JSONDecodeError:
                        payload = {"raw": text}

                    if resp.status >= 400:
                        message = payload.get("msg") or payload.get("message") or text
                        raise MexcAPIError(f"HTTP {resp.status}: {message}")

                    if isinstance(payload, dict) and payload.get("code") not in (None, 0, "0"):
                        raise MexcAPIError(
                            f"MEXC API error code={payload.get('code')}: {payload.get('msg') or payload.get('message') or payload}"
                        )

                    return payload
            except Exception as exc:
                if attempt >= retries:
                    raise
                self.logger.warning(
                    "MEXC request retry %s/%s path=%s reason=%s",
                    attempt,
                    retries,
                    path,
                    exc,
                )
                await asyncio.sleep(delay)
                delay = min(delay * 2.0, 8.0)

        raise MexcAPIError("Unreachable retry branch")

    async def get_ticker_price(self, symbol: str) -> float:
        payload = await self._request(
            "GET",
            "/api/v3/ticker/price",
            {"symbol": symbol},
            signed=False,
            retries=self.config.order_retries,
        )
        price = float(payload.get("price", 0.0))
        if price <= 0:
            raise MexcAPIError(f"Invalid ticker price payload: {payload}")
        return price

    async def load_symbol_filters(self, symbol: str) -> None:
        payload = await self._request(
            "GET",
            "/api/v3/exchangeInfo",
            {"symbol": symbol},
            signed=False,
            retries=self.config.order_retries,
        )
        symbols = payload.get("symbols") or []
        info = None
        for row in symbols:
            if str(row.get("symbol", "")).upper() == symbol.upper():
                info = row
                break
        if not info:
            self.logger.warning("No exchange info found for %s", symbol)
            return

        filters = info.get("filters") or []
        lot_size = next((f for f in filters if f.get("filterType") == "LOT_SIZE"), {})
        notional = next(
            (f for f in filters if f.get("filterType") in ("MIN_NOTIONAL", "NOTIONAL")),
            {},
        )

        step_size = float(lot_size.get("stepSize") or info.get("baseSizePrecision") or 0.0)
        min_qty = float(lot_size.get("minQty") or 0.0)
        min_notional = float(
            notional.get("minNotional")
            or notional.get("notional")
            or info.get("quoteAmountPrecisionMarket")
            or info.get("quoteAmountPrecision")
            or 0.0
        )

        self.symbol_filters = {
            "step_size": max(step_size, 0.0),
            "min_qty": max(min_qty, 0.0),
            "min_notional": max(min_notional, 0.0),
        }
        self.logger.info("Loaded symbol filters for %s: %s", symbol, self.symbol_filters)

    def _floor_to_step(self, value: float, step: float) -> float:
        if step <= 0:
            return value
        return np.floor(value / step) * step

    def _format_qty(self, qty: float) -> str:
        as_text = f"{qty:.12f}".rstrip("0").rstrip(".")
        return as_text if as_text else "0"

    def normalize_order_quantity(
        self,
        desired_qty: float,
        reference_price: float,
        *,
        allow_increase: bool = True,
    ) -> float:
        original_qty = float(desired_qty)
        qty = float(desired_qty)
        step = self.symbol_filters.get("step_size", 0.0)
        min_qty = self.symbol_filters.get("min_qty", 0.0)
        min_notional = self.symbol_filters.get("min_notional", 0.0)

        if allow_increase:
            if min_qty > 0:
                qty = max(qty, min_qty)
            if min_notional > 0 and reference_price > 0:
                qty = max(qty, min_notional / reference_price)

        if step > 0:
            qty = float(self._floor_to_step(qty, step))
            if allow_increase and qty <= 0 and min_qty > 0:
                qty = min_qty

        if not allow_increase:
            qty = min(qty, original_qty)

        return float(qty)

    async def place_market_order(self, side: str, quantity: float, symbol: str) -> Dict[str, Any]:
        normalized_side = side.upper().strip()
        if normalized_side not in {"BUY", "SELL"}:
            raise ValueError("side must be BUY or SELL")

        params = {
            "symbol": symbol.upper(),
            "side": normalized_side,
            "type": "MARKET",
            "quantity": self._format_qty(quantity),
        }

        self.logger.info("Placing %s market order symbol=%s quantity=%s", normalized_side, symbol, params["quantity"])

        return await self._request(
            "POST",
            "/api/v3/order",
            params,
            signed=True,
            retries=self.config.order_retries,
        )

    async def get_order(self, symbol: str, order_id: str) -> Dict[str, Any]:
        params = {
            "symbol": symbol.upper(),
            "orderId": order_id,
        }
        return await self._request(
            "GET",
            "/api/v3/order",
            params,
            signed=True,
            retries=self.config.order_retries,
        )

    async def wait_for_order_terminal_state(
        self,
        symbol: str,
        order_id: str,
        *,
        max_attempts: int = 8,
        wait_seconds: float = 0.8,
    ) -> Dict[str, Any]:
        terminal_states = {"FILLED", "CANCELED", "CANCELLED", "REJECTED", "EXPIRED"}
        latest: Dict[str, Any] = {}
        for _ in range(max_attempts):
            latest = await self.get_order(symbol, order_id)
            status = str(latest.get("status", "")).upper()
            if status in terminal_states:
                return latest
            await asyncio.sleep(wait_seconds)
        return latest

    @staticmethod
    def extract_fill_data(order_payload: Dict[str, Any], fallback_price: float, fallback_qty: float) -> Dict[str, Any]:
        status = str(order_payload.get("status") or "FILLED").upper()

        executed_qty = float(order_payload.get("executedQty") or order_payload.get("origQty") or fallback_qty)
        if executed_qty <= 0:
            executed_qty = fallback_qty

        fill_price = float(order_payload.get("price") or 0.0)
        quote_qty = float(order_payload.get("cummulativeQuoteQty") or order_payload.get("cumulativeQuoteQty") or 0.0)
        if fill_price <= 0 and quote_qty > 0 and executed_qty > 0:
            fill_price = quote_qty / executed_qty
        if fill_price <= 0:
            fill_price = fallback_price

        order_id = str(order_payload.get("orderId") or order_payload.get("id") or f"unknown-{int(time.time() * 1000)}")

        return {
            "order_id": order_id,
            "status": status,
            "filled_qty": executed_qty,
            "fill_price": fill_price,
            "raw": order_payload,
        }


class BackendReporter:
    def __init__(self, config: BotConfig, logger: logging.Logger):
        self.config = config
        self.logger = logger
        self.session: Optional[aiohttp.ClientSession] = None
        self.endpoint = f"{self.config.backend_url}/api/v1/internal/bot/order-result"

    async def start(self) -> None:
        if self.session and not self.session.closed:
            return
        timeout = aiohttp.ClientTimeout(total=self.config.request_timeout)
        self.session = aiohttp.ClientSession(timeout=timeout)

    async def close(self) -> None:
        if self.session and not self.session.closed:
            await self.session.close()

    def _sign_body(self, body: str) -> str:
        return hmac.new(
            self.config.internal_bot_token.encode("utf-8"),
            body.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def _prune_none(self, value: Any) -> Any:
        if isinstance(value, dict):
            return {k: self._prune_none(v) for k, v in value.items() if v is not None}
        if isinstance(value, list):
            return [self._prune_none(v) for v in value]
        return value

    async def report_trade(
        self,
        *,
        side: str,
        symbol: str,
        order_id: str,
        entry_price: float,
        quantity: float,
        filled_quantity: float,
        status: str,
        stop_loss: Optional[float],
        take_profit: Optional[float],
        signal_price: float,
        indicators: Dict[str, float],
        reason: str,
        exchange_payload: Dict[str, Any],
    ) -> bool:
        if not self.session or self.session.closed:
            await self.start()

        timestamp_ms = int(time.time() * 1000)

        payload: Dict[str, Any] = {
            # Fields requested by the user-facing internal contract.
            "botInstanceId": self.config.bot_instance_id,
            "workspaceId": self.config.workspace_id,
            "botId": self.config.bot_id,
            "orderId": order_id,
            "symbol": symbol,
            "side": side,
            "entryPrice": entry_price,
            "quantity": quantity,
            "filledQuantity": filled_quantity,
            "status": status,
            "stopLoss": stop_loss,
            "takeProfit": take_profit,
            "timestamp": timestamp_ms,
            "metadata": {
                "strategy": "MACD_Bollinger",
                "signalPrice": signal_price,
                "indicators": {
                    "macd": indicators.get("macd"),
                    "signal": indicators.get("signal"),
                    "bb_middle": indicators.get("bb_middle"),
                },
                "source": "python_bot",
                "exchange": "MEXC",
                "reason": reason,
            },
            # Additional shape compatible with backend writeBotOrderResult service.
            "normalizedSignal": {
                "id": f"sig-{timestamp_ms}",
                "symbol": symbol,
                "side": side,
                "quantity": quantity,
                "signal_price": signal_price,
                "strategy": "MACD_Bollinger",
                "meta": {
                    "source": "python_bot",
                    "botInstanceId": self.config.bot_instance_id,
                    "workspaceId": self.config.workspace_id,
                    "botId": self.config.bot_id,
                },
            },
            "entryOrder": {
                "venue": "mexc",
                "symbol": symbol,
                "side": side,
                "type": "MARKET",
                "qty": filled_quantity,
                "price": entry_price,
                "status": status.lower(),
                "orderId": order_id,
                "venueOrderId": order_id,
                "executedAt": timestamp_ms,
            },
            "sizing": {
                "status": status.lower(),
                "qtyRaw": quantity,
                "qtyFinal": filled_quantity,
                "refPrice": signal_price,
                "slPrice": stop_loss,
                "tpPrice": take_profit,
            },
            "protection": {
                "sl": {"price": stop_loss},
                "tp": {"price": take_profit},
            },
            "executionResult": {
                "orderId": order_id,
                "status": status,
                "executedQty": filled_quantity,
                "price": entry_price,
                "updateTime": timestamp_ms,
            },
            "rawPayload": exchange_payload,
            "meta": {
                "strategy": "MACD_Bollinger",
                "source": "python_bot",
                "botInstanceId": self.config.bot_instance_id,
                "workspaceId": self.config.workspace_id,
                "botId": self.config.bot_id,
                "reason": reason,
            },
        }

        payload = self._prune_none(payload)
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        signature = self._sign_body(body)

        headers = {
            "Authorization": f"Bearer {self.config.internal_bot_token}",
            "X-Internal-Token": self.config.internal_bot_token,
            "X-Bot-Token": self.config.internal_bot_token,
            "X-Signature": signature,
            "Content-Type": "application/json",
        }

        delay = 1.0
        for attempt in range(1, self.config.report_retries + 1):
            try:
                assert self.session is not None
                async with self.session.post(self.endpoint, data=body.encode("utf-8"), headers=headers) as resp:
                    response_text = await resp.text()
                    if 200 <= resp.status < 300:
                        self.logger.info(
                            "Reported trade to backend orderId=%s status=%s attempt=%s",
                            order_id,
                            resp.status,
                            attempt,
                        )
                        return True

                    self.logger.error(
                        "Backend report failed orderId=%s status=%s body=%s",
                        order_id,
                        resp.status,
                        response_text,
                    )
            except Exception as exc:
                self.logger.error(
                    "Backend report error orderId=%s attempt=%s error=%s",
                    order_id,
                    attempt,
                    exc,
                )

            if attempt < self.config.report_retries:
                await asyncio.sleep(delay)
                delay = min(delay * 2.0, 8.0)

        return False


class BackendRuntimeResolver:
    def __init__(self, config: BotConfig, logger: logging.Logger):
        self.config = config
        self.logger = logger
        self.session: Optional[aiohttp.ClientSession] = None

    async def start(self) -> None:
        if self.session and not self.session.closed:
            return
        timeout = aiohttp.ClientTimeout(total=self.config.request_timeout)
        self.session = aiohttp.ClientSession(timeout=timeout)

    async def close(self) -> None:
        if self.session and not self.session.closed:
            await self.session.close()

    async def fetch_runtime(self, bot_instance_id: str) -> Dict[str, Any]:
        if not self.session or self.session.closed:
            await self.start()

        base_path = self.config.backend_runtime_path.rstrip("/")
        endpoint = f"{self.config.backend_url}{base_path}/{bot_instance_id}"
        headers = {
            "Authorization": f"Bearer {self.config.internal_bot_token}",
            "X-Internal-Token": self.config.internal_bot_token,
        }

        delay = 1.0
        for attempt in range(1, self.config.runtime_retries + 1):
            try:
                assert self.session is not None
                async with self.session.get(endpoint, headers=headers) as resp:
                    text = await resp.text()
                    try:
                        payload = json.loads(text) if text else {}
                    except json.JSONDecodeError:
                        payload = {}

                    if 200 <= resp.status < 300:
                        return payload

                    self.logger.error(
                        "Runtime fetch failed status=%s attempt=%s body=%s",
                        resp.status,
                        attempt,
                        text,
                    )
            except Exception as exc:
                self.logger.error("Runtime fetch error attempt=%s error=%s", attempt, exc)

            if attempt < self.config.runtime_retries:
                await asyncio.sleep(delay)
                delay = min(delay * 2.0, 8.0)

        raise RuntimeError("Failed to fetch backend runtime config for linked exchange")


class MEXCWebSocketFeed:
    def __init__(self, config: BotConfig, strategy: MACDBollingerStrategy, logger: logging.Logger):
        self.config = config
        self.strategy = strategy
        self.logger = logger
        self.latest_price: Optional[float] = None
        self.last_update_ms: int = 0

    async def run(self, stop_event: asyncio.Event) -> None:
        reconnect_delay = 1.0
        max_delay = 60.0

        while not stop_event.is_set():
            try:
                await self._connect_and_stream(stop_event)
                reconnect_delay = 1.0
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                if stop_event.is_set():
                    break
                self.logger.error("WebSocket error: %s", exc)

            if stop_event.is_set():
                break

            self.logger.warning("WebSocket reconnecting in %.1fs", reconnect_delay)
            await asyncio.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 2.0, max_delay)

    async def _connect_and_stream(self, stop_event: asyncio.Event) -> None:
        timeout = aiohttp.ClientTimeout(total=None)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.ws_connect(self.config.ws_url, heartbeat=20) as ws:
                self.logger.info("Connected to MEXC WebSocket")
                subscribe_message = {
                    "method": "SUBSCRIPTION",
                    "params": [f"spot@public.miniTicker.v3.api@{self.config.symbol}"],
                }
                await ws.send_json(subscribe_message)
                self.logger.info("Subscribed to %s miniTicker", self.config.symbol)

                async for msg in ws:
                    if stop_event.is_set():
                        await ws.close()
                        break

                    if msg.type == aiohttp.WSMsgType.TEXT:
                        await self._handle_text_message(ws, msg.data)
                    elif msg.type == aiohttp.WSMsgType.ERROR:
                        raise RuntimeError(f"WebSocket message error: {ws.exception()}")
                    elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSING):
                        raise RuntimeError("WebSocket connection closed")

    async def _handle_text_message(self, ws: aiohttp.ClientWebSocketResponse, raw: str) -> None:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            self.logger.debug("Ignoring non-JSON websocket payload: %s", raw)
            return

        # Some servers send ping frames inside JSON payload.
        if isinstance(data, dict) and "ping" in data:
            await ws.send_json({"pong": data["ping"]})
            return

        price = self._extract_price(data)
        if price is None:
            return

        self.latest_price = price
        self.last_update_ms = int(time.time() * 1000)
        self.strategy.update_price(price)

    def _extract_price(self, payload: Dict[str, Any]) -> Optional[float]:
        candidate: Optional[Any] = None

        if isinstance(payload.get("d"), dict):
            d = payload["d"]
            candidate = d.get("c") or d.get("p") or d.get("lastPrice")
        elif isinstance(payload.get("data"), dict):
            d = payload["data"]
            candidate = d.get("c") or d.get("p") or d.get("lastPrice")
        else:
            candidate = payload.get("c") or payload.get("price")

        if candidate is None:
            return None

        try:
            price = float(candidate)
        except (TypeError, ValueError):
            return None

        if price <= 0:
            return None
        return price


class TradingBot:
    def __init__(self, config: BotConfig, logger: logging.Logger):
        self.config = config
        self.logger = logger

        self.strategy = MACDBollingerStrategy(config, logger.getChild("strategy"))
        self.mexc = MEXCClient(config, logger.getChild("mexc"))
        self.reporter = BackendReporter(config, logger.getChild("reporter"))
        self.runtime_resolver = BackendRuntimeResolver(config, logger.getChild("runtime"))
        self.feed = MEXCWebSocketFeed(config, self.strategy, logger.getChild("ws"))

        self.position = PositionState()
        self.stop_event = asyncio.Event()
        self.tasks: List[asyncio.Task] = []

        self.last_signal_eval = 0.0
        self.cooldown_until = 0.0
        self.order_lock = asyncio.Lock()
        self._shutting_down = False

    def request_stop(self) -> None:
        self.stop_event.set()

    async def initialize(self) -> None:
        await self.runtime_resolver.start()
        if self.config.resolve_exchange_from_backend:
            try:
                await self._hydrate_from_linked_exchange_runtime()
            except Exception as exc:
                if self.config.mexc_api_key and self.config.mexc_api_secret:
                    self.logger.warning(
                        "Linked-runtime resolution failed (%s). Falling back to env MEXC credentials.",
                        exc,
                    )
                else:
                    raise

        if not self.config.mexc_api_key or not self.config.mexc_api_secret:
            raise ValueError(
                "MEXC credentials are missing. Link an exchange to the bot instance or set MEXC_API_KEY/MEXC_API_SECRET."
            )

        await self.mexc.start()
        await self.reporter.start()

        try:
            await self.mexc.load_symbol_filters(self.config.symbol)
        except Exception as exc:
            self.logger.warning("Failed to load symbol filters: %s", exc)

        # Seed strategy with at least one price if websocket has not updated yet.
        try:
            ticker_price = await self.mexc.get_ticker_price(self.config.symbol)
            self.strategy.update_price(ticker_price)
            self.logger.info("Initial ticker price loaded: %.8f", ticker_price)
        except Exception as exc:
            self.logger.warning("Could not fetch initial ticker price: %s", exc)

    @staticmethod
    def _normalize_symbol(symbol: str) -> str:
        return str(symbol or "").upper().replace("/", "").replace("-", "").replace("_", "").strip()

    @staticmethod
    def _rule_pick(rules: Any, keys: List[str]) -> Optional[Any]:
        if not isinstance(rules, dict):
            return None
        nested = rules.get("codeParameters")
        nested_params = nested if isinstance(nested, dict) else {}
        for key in keys:
            if key in rules and rules[key] is not None:
                return rules[key]
            if key in nested_params and nested_params[key] is not None:
                return nested_params[key]
        return None

    def _rule_float(self, rules: Any, keys: List[str], *, min_value: Optional[float] = None) -> Optional[float]:
        value = self._rule_pick(rules, keys)
        if value is None:
            return None
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return None
        if not np.isfinite(parsed):
            return None
        if min_value is not None and parsed < min_value:
            return None
        return parsed

    def _rule_int(self, rules: Any, keys: List[str], *, min_value: Optional[int] = None) -> Optional[int]:
        value = self._rule_pick(rules, keys)
        if value is None:
            return None
        try:
            parsed = int(float(value))
        except (TypeError, ValueError):
            return None
        if min_value is not None and parsed < min_value:
            return None
        return parsed

    def _rule_bool(self, rules: Any, keys: List[str]) -> Optional[bool]:
        value = self._rule_pick(rules, keys)
        if value is None:
            return None
        if isinstance(value, bool):
            return value
        text = str(value).strip().lower()
        if text in {"1", "true", "yes", "on"}:
            return True
        if text in {"0", "false", "no", "off"}:
            return False
        return None

    @staticmethod
    def _normalize_tp_mode(value: Any) -> Optional[str]:
        normalized = str(value or "").strip().lower()
        if not normalized:
            return None
        if normalized in {"fixed", "percent"}:
            return "fixed"
        if normalized in {"trailing", "trail"}:
            return "trailing"
        return None

    def _is_trailing_take_profit_enabled(self) -> bool:
        mode = self._normalize_tp_mode(self.config.take_profit_mode) or "fixed"
        if mode != "trailing":
            return False
        if not self.config.trailing_take_profit_enabled:
            return False
        return self.config.trailing_take_profit_pct > 0

    def _trailing_distance_ratio(self) -> float:
        return max(0.0, float(self.config.trailing_take_profit_pct)) / 100.0

    def _trailing_activation_ratio(self) -> float:
        return max(0.0, float(self.config.trailing_take_profit_activation_pct)) / 100.0

    def _build_trailing_state(self, side: str, entry_price: float) -> Dict[str, float | bool]:
        if not self._is_trailing_take_profit_enabled():
            return {
                "trailing_active": False,
                "trailing_anchor_price": 0.0,
                "trailing_stop_price": 0.0,
                "trailing_activation_price": 0.0,
            }

        activation_ratio = self._trailing_activation_ratio()
        trailing_active = activation_ratio <= 1e-12
        if side == "LONG":
            activation_price = entry_price * (1.0 + activation_ratio)
            initial_stop = entry_price * (1.0 - self._trailing_distance_ratio()) if trailing_active else 0.0
        else:
            activation_price = entry_price * (1.0 - activation_ratio)
            initial_stop = entry_price * (1.0 + self._trailing_distance_ratio()) if trailing_active else 0.0
        return {
            "trailing_active": trailing_active,
            "trailing_anchor_price": entry_price,
            "trailing_stop_price": initial_stop,
            "trailing_activation_price": activation_price,
        }

    def _apply_runtime_rule_overrides(self, rules: Any) -> None:
        symbol_override = self._rule_pick(rules, ["symbol", "SYMBOL"])
        normalized_symbol = self._normalize_symbol(str(symbol_override or ""))
        if normalized_symbol and normalized_symbol != self.config.symbol:
            self.logger.info("Applying symbol override from runtime rules: %s -> %s", self.config.symbol, normalized_symbol)
            self.config.symbol = normalized_symbol

        qty_override = self._rule_float(
            rules,
            ["baseQuantity", "base_quantity", "quantity", "qty", "BASE_QUANTITY"],
            min_value=0.00000001,
        )
        if qty_override and abs(qty_override - self.config.base_quantity) > 1e-12:
            self.logger.info(
                "Applying base quantity override from runtime rules: %.12f -> %.12f",
                self.config.base_quantity,
                qty_override,
            )
            self.config.base_quantity = qty_override

        check_interval = self._rule_int(rules, ["checkInterval", "check_interval", "CHECK_INTERVAL"], min_value=1)
        if check_interval and check_interval != self.config.check_interval:
            self.logger.info("Applying check interval override: %s -> %s", self.config.check_interval, check_interval)
            self.config.check_interval = check_interval

        macd_fast = self._rule_int(rules, ["macdFast", "macd_fast", "MACD_FAST"], min_value=1)
        macd_slow = self._rule_int(rules, ["macdSlow", "macd_slow", "MACD_SLOW"], min_value=1)
        macd_signal = self._rule_int(rules, ["macdSignal", "macd_signal", "MACD_SIGNAL"], min_value=1)
        if macd_fast and macd_slow and macd_fast < macd_slow:
            if macd_fast != self.config.macd_fast:
                self.logger.info("Applying MACD fast override: %s -> %s", self.config.macd_fast, macd_fast)
                self.config.macd_fast = macd_fast
            if macd_slow != self.config.macd_slow:
                self.logger.info("Applying MACD slow override: %s -> %s", self.config.macd_slow, macd_slow)
                self.config.macd_slow = macd_slow
        if macd_signal and macd_signal != self.config.macd_signal:
            self.logger.info("Applying MACD signal override: %s -> %s", self.config.macd_signal, macd_signal)
            self.config.macd_signal = macd_signal

        bb_length = self._rule_int(rules, ["bbLength", "bb_length", "BB_LENGTH"], min_value=2)
        if bb_length and bb_length != self.config.bb_length:
            self.logger.info("Applying BB length override: %s -> %s", self.config.bb_length, bb_length)
            self.config.bb_length = bb_length

        bb_mult = self._rule_float(rules, ["bbMult", "bb_mult", "BB_MULT"], min_value=0.0000001)
        if bb_mult and abs(bb_mult - self.config.bb_mult) > 1e-12:
            self.logger.info("Applying BB multiplier override: %s -> %s", self.config.bb_mult, bb_mult)
            self.config.bb_mult = bb_mult

        stop_loss_pct = self._rule_float(rules, ["stopLossPct", "stop_loss_pct", "STOP_LOSS_PCT"], min_value=0.0000001)
        if stop_loss_pct and abs(stop_loss_pct - self.config.stop_loss_pct) > 1e-12:
            self.logger.info("Applying stop loss override: %s -> %s", self.config.stop_loss_pct, stop_loss_pct)
            self.config.stop_loss_pct = stop_loss_pct

        risk_reward = self._rule_int(rules, ["riskReward", "risk_reward", "RISK_REWARD"], min_value=1)
        if risk_reward and risk_reward != self.config.risk_reward:
            self.logger.info("Applying risk/reward override: %s -> %s", self.config.risk_reward, risk_reward)
            self.config.risk_reward = risk_reward

        allow_shorts = self._rule_bool(rules, ["allowShorts", "allow_shorts", "ALLOW_SHORTS"])
        if allow_shorts is not None and allow_shorts != self.config.allow_shorts:
            self.logger.info("Applying allow_shorts override: %s -> %s", self.config.allow_shorts, allow_shorts)
            self.config.allow_shorts = allow_shorts

        tp_mode_raw = self._rule_pick(rules, ["tpType", "tp_type", "TP_TYPE"])
        tp_mode = self._normalize_tp_mode(tp_mode_raw)
        if tp_mode and tp_mode != self._normalize_tp_mode(self.config.take_profit_mode):
            self.logger.info("Applying take profit mode override: %s -> %s", self.config.take_profit_mode, tp_mode)
            self.config.take_profit_mode = tp_mode

        trailing_enabled = self._rule_bool(
            rules,
            [
                "trailingTakeProfitEnabled",
                "trailing_take_profit_enabled",
                "trailingTpEnabled",
                "TRAILING_TAKE_PROFIT_ENABLED",
            ],
        )
        if trailing_enabled is not None and trailing_enabled != self.config.trailing_take_profit_enabled:
            self.logger.info(
                "Applying trailing TP enabled override: %s -> %s",
                self.config.trailing_take_profit_enabled,
                trailing_enabled,
            )
            self.config.trailing_take_profit_enabled = trailing_enabled

        tp_value = self._rule_float(rules, ["tpValue", "tp_value"], min_value=0.0)
        trailing_tp_pct = self._rule_float(
            rules,
            [
                "trailingTpPct",
                "trailing_tp_pct",
                "trailingTakeProfitPct",
                "trailing_take_profit_pct",
                "TRAILING_TP_PCT",
            ],
            min_value=0.0,
        )

        if trailing_tp_pct is None and self._normalize_tp_mode(self.config.take_profit_mode) == "trailing" and tp_value is not None:
            trailing_tp_pct = tp_value

        if trailing_tp_pct is not None and trailing_tp_pct > 0 and abs(trailing_tp_pct - self.config.trailing_take_profit_pct) > 1e-12:
            self.logger.info(
                "Applying trailing TP percent override: %s -> %s",
                self.config.trailing_take_profit_pct,
                trailing_tp_pct,
            )
            self.config.trailing_take_profit_pct = trailing_tp_pct

        trailing_activation_pct = self._rule_float(
            rules,
            [
                "trailingActivationPct",
                "trailing_activation_pct",
                "trailingTpActivationPct",
                "trailing_tp_activation_pct",
                "trailingTakeProfitActivationPct",
                "trailing_take_profit_activation_pct",
                "TRAILING_TP_ACTIVATION_PCT",
            ],
            min_value=0.0,
        )

        if trailing_activation_pct is None and self._normalize_tp_mode(self.config.take_profit_mode) == "trailing" and tp_value is not None:
            trailing_activation_pct = tp_value

        if trailing_activation_pct is not None and abs(trailing_activation_pct - self.config.trailing_take_profit_activation_pct) > 1e-12:
            self.logger.info(
                "Applying trailing TP activation percent override: %s -> %s",
                self.config.trailing_take_profit_activation_pct,
                trailing_activation_pct,
            )
            self.config.trailing_take_profit_activation_pct = trailing_activation_pct

        if self._normalize_tp_mode(self.config.take_profit_mode) == "trailing" and trailing_enabled is None:
            self.config.trailing_take_profit_enabled = True
        if self._normalize_tp_mode(self.config.take_profit_mode) == "fixed" and trailing_enabled is None:
            self.config.trailing_take_profit_enabled = False

    async def _hydrate_from_linked_exchange_runtime(self) -> None:
        runtime = await self.runtime_resolver.fetch_runtime(self.config.bot_instance_id)
        exchange = runtime.get("exchangeAccount") if isinstance(runtime, dict) else {}
        bot_instance = runtime.get("botInstance") if isinstance(runtime, dict) else {}
        runtime_meta = runtime.get("runtime") if isinstance(runtime, dict) else {}

        runtime_workspace_id = str((bot_instance or {}).get("workspaceId") or "").strip()
        runtime_bot_id = str((bot_instance or {}).get("botId") or "").strip()
        if runtime_workspace_id:
            self.config.workspace_id = runtime_workspace_id
        if runtime_bot_id:
            self.config.bot_id = runtime_bot_id

        venue = str((exchange or {}).get("venue") or "").strip().lower()
        if venue and "mexc" not in venue:
            raise ValueError(
                f"Linked exchange venue '{venue}' is not supported by this bot. Expected a MEXC linked exchange."
            )

        runtime_symbol = self._normalize_symbol((bot_instance or {}).get("symbol") or "")
        if runtime_symbol:
            if runtime_symbol != self.config.symbol:
                self.logger.info(
                    "Using symbol from linked exchange runtime: %s -> %s",
                    self.config.symbol,
                    runtime_symbol,
                )
            self.config.symbol = runtime_symbol

        runtime_api_key = str((exchange or {}).get("apiKey") or "").strip()
        runtime_api_secret = str((exchange or {}).get("apiSecret") or "").strip()
        if runtime_api_key and runtime_api_secret:
            self.config.mexc_api_key = runtime_api_key
            self.config.mexc_api_secret = runtime_api_secret
            self.logger.info(
                "Loaded exchange credentials from linked account id=%s",
                (exchange or {}).get("id"),
            )
        else:
            self.logger.warning(
                "Linked runtime has no decrypted API keys. Falling back to env credentials if provided."
            )

        self._apply_runtime_rule_overrides((runtime_meta or {}).get("rules"))

    async def run(self) -> None:
        await self.initialize()

        self.tasks = [
            asyncio.create_task(self.feed.run(self.stop_event), name="ws-feed"),
            asyncio.create_task(self.trading_loop(), name="trading-loop"),
            asyncio.create_task(self.health_loop(), name="health-loop"),
        ]

        await self.stop_event.wait()
        await self.shutdown()

    async def shutdown(self) -> None:
        if self._shutting_down:
            return
        self._shutting_down = True

        self.logger.info("Shutting down bot")
        self.stop_event.set()

        for task in self.tasks:
            if not task.done():
                task.cancel()

        if self.tasks:
            await asyncio.gather(*self.tasks, return_exceptions=True)

        await self.mexc.close()
        await self.reporter.close()
        await self.runtime_resolver.close()

        self.logger.info("Shutdown complete")

    async def trading_loop(self) -> None:
        self.logger.info("Trading loop started")

        while not self.stop_event.is_set():
            try:
                latest_price = self.feed.latest_price or self.strategy.latest_price
                if latest_price and self.position.side != "FLAT":
                    await self._check_protection_exits(latest_price)

                now = time.time()
                if now - self.last_signal_eval >= self.config.check_interval:
                    self.last_signal_eval = now
                    await self._evaluate_signal()

                await asyncio.sleep(1)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                self.logger.exception("Trading loop error: %s", exc)
                await asyncio.sleep(2)

    async def _evaluate_signal(self) -> None:
        signal_snapshot = self.strategy.compute_signal()

        if not signal_snapshot:
            self.logger.debug(
                "No signal. buffer_size=%s required=%s",
                len(self.strategy.prices),
                self.strategy.min_required_points(),
            )
            return

        if time.time() < self.cooldown_until:
            self.logger.info("Signal ignored due to cooldown action=%s", signal_snapshot.action)
            return

        if signal_snapshot.action == "BUY":
            if self.position.side == "LONG":
                self.logger.info("BUY signal ignored because position is already LONG")
                return
            await self._open_long(signal_snapshot)
            return

        if signal_snapshot.action == "SELL":
            if self.position.side == "LONG":
                await self._close_long(signal_snapshot, reason="SIGNAL_SELL")
                return

            if self.config.allow_shorts:
                await self._open_short(signal_snapshot)
                return

            self.logger.info("SELL signal ignored while flat (spot long-only mode)")

    async def _check_protection_exits(self, latest_price: float) -> None:
        if self.position.side == "LONG":
            if self.position.stop_loss > 0 and latest_price <= self.position.stop_loss:
                synthetic = SignalSnapshot(
                    action="SELL",
                    signal_price=latest_price,
                    stop_loss=self.position.stop_loss,
                    take_profit=self.position.take_profit,
                    indicators=self._last_indicator_snapshot(),
                )
                await self._close_long(synthetic, reason="STOP_LOSS")
                return

            if self._is_trailing_take_profit_enabled():
                if self._update_long_trailing(latest_price):
                    synthetic = SignalSnapshot(
                        action="SELL",
                        signal_price=latest_price,
                        stop_loss=self.position.stop_loss,
                        take_profit=self.position.trailing_stop_price or self.position.take_profit,
                        indicators=self._last_indicator_snapshot(),
                    )
                    await self._close_long(synthetic, reason="TRAILING_TAKE_PROFIT")
                    return
            elif self.position.take_profit > 0 and latest_price >= self.position.take_profit:
                synthetic = SignalSnapshot(
                    action="SELL",
                    signal_price=latest_price,
                    stop_loss=self.position.stop_loss,
                    take_profit=self.position.take_profit,
                    indicators=self._last_indicator_snapshot(),
                )
                await self._close_long(synthetic, reason="TAKE_PROFIT")
                return

        if self.position.side == "SHORT":
            if self.position.stop_loss > 0 and latest_price >= self.position.stop_loss:
                synthetic = SignalSnapshot(
                    action="BUY",
                    signal_price=latest_price,
                    stop_loss=self.position.stop_loss,
                    take_profit=self.position.take_profit,
                    indicators=self._last_indicator_snapshot(),
                )
                await self._close_short(synthetic, reason="STOP_LOSS")
                return

            if self._is_trailing_take_profit_enabled():
                if self._update_short_trailing(latest_price):
                    synthetic = SignalSnapshot(
                        action="BUY",
                        signal_price=latest_price,
                        stop_loss=self.position.stop_loss,
                        take_profit=self.position.trailing_stop_price or self.position.take_profit,
                        indicators=self._last_indicator_snapshot(),
                    )
                    await self._close_short(synthetic, reason="TRAILING_TAKE_PROFIT")
                    return
            elif self.position.take_profit > 0 and latest_price <= self.position.take_profit:
                synthetic = SignalSnapshot(
                    action="BUY",
                    signal_price=latest_price,
                    stop_loss=self.position.stop_loss,
                    take_profit=self.position.take_profit,
                    indicators=self._last_indicator_snapshot(),
                )
                await self._close_short(synthetic, reason="TAKE_PROFIT")

    def _update_long_trailing(self, latest_price: float) -> bool:
        if self.position.side != "LONG" or latest_price <= 0:
            return False
        trailing_ratio = self._trailing_distance_ratio()
        if trailing_ratio <= 0:
            return False

        if not self.position.trailing_active:
            activation_price = (
                self.position.trailing_activation_price
                if self.position.trailing_activation_price > 0
                else self.position.entry_price
            )
            if latest_price < activation_price:
                return False
            self.position.trailing_active = True
            self.position.trailing_anchor_price = max(self.position.trailing_anchor_price, latest_price)
            self.position.trailing_stop_price = self.position.trailing_anchor_price * (1.0 - trailing_ratio)
            self.position.take_profit = self.position.trailing_stop_price
            self.logger.info(
                "Trailing TP activated LONG entry=%.8f activation=%.8f anchor=%.8f stop=%.8f",
                self.position.entry_price,
                activation_price,
                self.position.trailing_anchor_price,
                self.position.trailing_stop_price,
            )

        if latest_price > self.position.trailing_anchor_price + 1e-12:
            self.position.trailing_anchor_price = latest_price
            self.position.trailing_stop_price = latest_price * (1.0 - trailing_ratio)
            self.position.take_profit = self.position.trailing_stop_price
            self.logger.debug(
                "Trailing TP LONG moved anchor=%.8f stop=%.8f",
                self.position.trailing_anchor_price,
                self.position.trailing_stop_price,
            )

        return self.position.trailing_stop_price > 0 and latest_price <= self.position.trailing_stop_price

    def _update_short_trailing(self, latest_price: float) -> bool:
        if self.position.side != "SHORT" or latest_price <= 0:
            return False
        trailing_ratio = self._trailing_distance_ratio()
        if trailing_ratio <= 0:
            return False

        if not self.position.trailing_active:
            activation_price = (
                self.position.trailing_activation_price
                if self.position.trailing_activation_price > 0
                else self.position.entry_price
            )
            if latest_price > activation_price:
                return False
            self.position.trailing_active = True
            self.position.trailing_anchor_price = (
                latest_price if self.position.trailing_anchor_price <= 0 else min(self.position.trailing_anchor_price, latest_price)
            )
            self.position.trailing_stop_price = self.position.trailing_anchor_price * (1.0 + trailing_ratio)
            self.position.take_profit = self.position.trailing_stop_price
            self.logger.info(
                "Trailing TP activated SHORT entry=%.8f activation=%.8f anchor=%.8f stop=%.8f",
                self.position.entry_price,
                activation_price,
                self.position.trailing_anchor_price,
                self.position.trailing_stop_price,
            )

        if self.position.trailing_anchor_price <= 0 or latest_price < self.position.trailing_anchor_price - 1e-12:
            self.position.trailing_anchor_price = latest_price
            self.position.trailing_stop_price = latest_price * (1.0 + trailing_ratio)
            self.position.take_profit = self.position.trailing_stop_price
            self.logger.debug(
                "Trailing TP SHORT moved anchor=%.8f stop=%.8f",
                self.position.trailing_anchor_price,
                self.position.trailing_stop_price,
            )

        return self.position.trailing_stop_price > 0 and latest_price >= self.position.trailing_stop_price

    def _last_indicator_snapshot(self) -> Dict[str, float]:
        snapshot = self.strategy.compute_signal()
        if snapshot:
            return snapshot.indicators

        prices = list(self.strategy.prices)
        if not prices:
            return {"macd": 0.0, "signal": 0.0, "bb_middle": 0.0}

        series = np.array(prices, dtype=float)
        if len(series) < self.strategy.min_required_points():
            last_price = float(series[-1])
            return {"macd": 0.0, "signal": 0.0, "bb_middle": last_price}

        macd_line, signal_line, _ = self.strategy._macd(series)
        _, bb_middle, _ = self.strategy._bollinger_middle(series)

        return {
            "macd": float(macd_line[-1]),
            "signal": float(signal_line[-1]),
            "bb_middle": float(bb_middle),
        }

    async def _execute_order(
        self,
        side: str,
        desired_qty: float,
        signal_price: float,
        *,
        allow_increase: bool = True,
    ) -> Dict[str, Any]:
        normalized_qty = self.mexc.normalize_order_quantity(
            desired_qty,
            signal_price,
            allow_increase=allow_increase,
        )
        if normalized_qty <= 0:
            raise ValueError("Normalized quantity is 0; check BASE_QUANTITY and symbol filters")

        order_response = await self.mexc.place_market_order(side, normalized_qty, self.config.symbol)
        order_id = str(order_response.get("orderId") or order_response.get("id") or "")

        terminal_payload = order_response
        if order_id:
            try:
                terminal_payload = await self.mexc.wait_for_order_terminal_state(self.config.symbol, order_id)
            except Exception as exc:
                self.logger.warning("Order status polling failed for %s: %s", order_id, exc)

        fill = self.mexc.extract_fill_data(terminal_payload, signal_price, normalized_qty)
        fill["requested_qty"] = normalized_qty
        return fill

    @staticmethod
    def _is_order_filled(status: str, filled_qty: float) -> bool:
        normalized = str(status or "").upper()
        return filled_qty > 0 and normalized in {"FILLED", "PARTIALLY_FILLED"}

    async def _open_long(self, signal_snapshot: SignalSnapshot) -> None:
        async with self.order_lock:
            if self.position.side == "LONG":
                return

            self.logger.info(
                "BUY signal detected price=%.8f macd=%.8f signal=%.8f bb_middle=%.8f",
                signal_snapshot.signal_price,
                signal_snapshot.indicators.get("macd", 0.0),
                signal_snapshot.indicators.get("signal", 0.0),
                signal_snapshot.indicators.get("bb_middle", 0.0),
            )

            fill = await self._execute_order("BUY", self.config.base_quantity, signal_snapshot.signal_price)

            fill_price = float(fill["fill_price"])
            filled_qty = float(fill["filled_qty"])
            order_status = str(fill["status"])

            # Recalculate TP/SL from real fill price.
            stop_loss = fill_price * (1.0 - (self.config.stop_loss_pct / 100.0))
            take_profit = fill_price * (
                1.0 + ((self.config.stop_loss_pct / 100.0) * self.config.risk_reward)
            )
            trailing_state = self._build_trailing_state("LONG", fill_price)
            reported_take_profit = take_profit
            if self._is_trailing_take_profit_enabled():
                if trailing_state["trailing_active"] and trailing_state["trailing_stop_price"] > 0:
                    reported_take_profit = float(trailing_state["trailing_stop_price"])
                elif trailing_state["trailing_activation_price"] > 0:
                    reported_take_profit = float(trailing_state["trailing_activation_price"])

            reported = await self.reporter.report_trade(
                side="BUY",
                symbol=self.config.symbol,
                order_id=str(fill["order_id"]),
                entry_price=fill_price,
                quantity=float(fill["requested_qty"]),
                filled_quantity=filled_qty,
                status=order_status,
                stop_loss=stop_loss,
                take_profit=reported_take_profit,
                signal_price=signal_snapshot.signal_price,
                indicators=signal_snapshot.indicators,
                reason="ENTRY_LONG",
                exchange_payload=fill["raw"],
            )

            if not reported:
                self.logger.error("Order placed but backend report failed for orderId=%s", fill["order_id"])

            self.cooldown_until = time.time() + self.config.check_interval
            if self._is_order_filled(order_status, filled_qty):
                self.position = PositionState(
                    side="LONG",
                    quantity=filled_qty,
                    entry_price=fill_price,
                    stop_loss=stop_loss,
                    take_profit=reported_take_profit,
                    opened_at_ms=int(time.time() * 1000),
                    trailing_active=bool(trailing_state["trailing_active"]),
                    trailing_anchor_price=float(trailing_state["trailing_anchor_price"]),
                    trailing_stop_price=float(trailing_state["trailing_stop_price"]),
                    trailing_activation_price=float(trailing_state["trailing_activation_price"]),
                )
                self.logger.info(
                    "Opened LONG qty=%.8f entry=%.8f sl=%.8f tp=%.8f trailing=%s",
                    filled_qty,
                    fill_price,
                    stop_loss,
                    reported_take_profit,
                    self._is_trailing_take_profit_enabled(),
                )
            else:
                self.logger.error(
                    "BUY order not filled orderId=%s status=%s filledQty=%.8f",
                    fill["order_id"],
                    order_status,
                    filled_qty,
                )

    async def _close_long(self, signal_snapshot: SignalSnapshot, reason: str) -> None:
        async with self.order_lock:
            if self.position.side != "LONG":
                return

            qty = self.position.quantity if self.position.quantity > 0 else self.config.base_quantity
            fill = await self._execute_order(
                "SELL",
                qty,
                signal_snapshot.signal_price,
                allow_increase=False,
            )

            fill_price = float(fill["fill_price"])
            filled_qty = float(fill["filled_qty"])
            order_status = str(fill["status"])

            reported = await self.reporter.report_trade(
                side="SELL",
                symbol=self.config.symbol,
                order_id=str(fill["order_id"]),
                entry_price=fill_price,
                quantity=float(fill["requested_qty"]),
                filled_quantity=filled_qty,
                status=order_status,
                stop_loss=self.position.stop_loss,
                take_profit=self.position.take_profit,
                signal_price=signal_snapshot.signal_price,
                indicators=signal_snapshot.indicators,
                reason=reason,
                exchange_payload=fill["raw"],
            )

            if not reported:
                self.logger.error("Exit order placed but backend report failed for orderId=%s", fill["order_id"])

            self.logger.info(
                "Closed LONG qty=%.8f exit=%.8f reason=%s",
                filled_qty,
                fill_price,
                reason,
            )

            self.cooldown_until = time.time() + self.config.check_interval
            if self._is_order_filled(order_status, filled_qty):
                remaining = max(self.position.quantity - filled_qty, 0.0)
                if remaining > 1e-12 and str(order_status).upper() == "PARTIALLY_FILLED":
                    self.position.quantity = remaining
                    self.logger.warning(
                        "Partial LONG close. remaining_qty=%.8f orderId=%s",
                        remaining,
                        fill["order_id"],
                    )
                else:
                    self.position = PositionState()
            else:
                self.logger.error(
                    "SELL close order not filled orderId=%s status=%s filledQty=%.8f; position kept",
                    fill["order_id"],
                    order_status,
                    filled_qty,
                )

    async def _open_short(self, signal_snapshot: SignalSnapshot) -> None:
        async with self.order_lock:
            if self.position.side == "SHORT":
                return

            fill = await self._execute_order("SELL", self.config.base_quantity, signal_snapshot.signal_price)

            fill_price = float(fill["fill_price"])
            filled_qty = float(fill["filled_qty"])
            order_status = str(fill["status"])

            stop_loss = fill_price * (1.0 + (self.config.stop_loss_pct / 100.0))
            take_profit = fill_price * (
                1.0 - ((self.config.stop_loss_pct / 100.0) * self.config.risk_reward)
            )
            trailing_state = self._build_trailing_state("SHORT", fill_price)
            reported_take_profit = take_profit
            if self._is_trailing_take_profit_enabled():
                if trailing_state["trailing_active"] and trailing_state["trailing_stop_price"] > 0:
                    reported_take_profit = float(trailing_state["trailing_stop_price"])
                elif trailing_state["trailing_activation_price"] > 0:
                    reported_take_profit = float(trailing_state["trailing_activation_price"])

            reported = await self.reporter.report_trade(
                side="SELL",
                symbol=self.config.symbol,
                order_id=str(fill["order_id"]),
                entry_price=fill_price,
                quantity=float(fill["requested_qty"]),
                filled_quantity=filled_qty,
                status=order_status,
                stop_loss=stop_loss,
                take_profit=reported_take_profit,
                signal_price=signal_snapshot.signal_price,
                indicators=signal_snapshot.indicators,
                reason="ENTRY_SHORT",
                exchange_payload=fill["raw"],
            )

            if not reported:
                self.logger.error("Short order placed but backend report failed for orderId=%s", fill["order_id"])

            self.cooldown_until = time.time() + self.config.check_interval
            if self._is_order_filled(order_status, filled_qty):
                self.position = PositionState(
                    side="SHORT",
                    quantity=filled_qty,
                    entry_price=fill_price,
                    stop_loss=stop_loss,
                    take_profit=reported_take_profit,
                    opened_at_ms=int(time.time() * 1000),
                    trailing_active=bool(trailing_state["trailing_active"]),
                    trailing_anchor_price=float(trailing_state["trailing_anchor_price"]),
                    trailing_stop_price=float(trailing_state["trailing_stop_price"]),
                    trailing_activation_price=float(trailing_state["trailing_activation_price"]),
                )
                self.logger.info(
                    "Opened SHORT qty=%.8f entry=%.8f sl=%.8f tp=%.8f trailing=%s",
                    filled_qty,
                    fill_price,
                    stop_loss,
                    reported_take_profit,
                    self._is_trailing_take_profit_enabled(),
                )
            else:
                self.logger.error(
                    "Short entry order not filled orderId=%s status=%s filledQty=%.8f",
                    fill["order_id"],
                    order_status,
                    filled_qty,
                )

    async def _close_short(self, signal_snapshot: SignalSnapshot, reason: str) -> None:
        async with self.order_lock:
            if self.position.side != "SHORT":
                return

            qty = self.position.quantity if self.position.quantity > 0 else self.config.base_quantity
            fill = await self._execute_order(
                "BUY",
                qty,
                signal_snapshot.signal_price,
                allow_increase=False,
            )

            fill_price = float(fill["fill_price"])
            filled_qty = float(fill["filled_qty"])
            order_status = str(fill["status"])

            reported = await self.reporter.report_trade(
                side="BUY",
                symbol=self.config.symbol,
                order_id=str(fill["order_id"]),
                entry_price=fill_price,
                quantity=float(fill["requested_qty"]),
                filled_quantity=filled_qty,
                status=order_status,
                stop_loss=self.position.stop_loss,
                take_profit=self.position.take_profit,
                signal_price=signal_snapshot.signal_price,
                indicators=signal_snapshot.indicators,
                reason=reason,
                exchange_payload=fill["raw"],
            )

            if not reported:
                self.logger.error("Short close order placed but backend report failed for orderId=%s", fill["order_id"])

            self.cooldown_until = time.time() + self.config.check_interval
            if self._is_order_filled(order_status, filled_qty):
                remaining = max(self.position.quantity - filled_qty, 0.0)
                if remaining > 1e-12 and str(order_status).upper() == "PARTIALLY_FILLED":
                    self.position.quantity = remaining
                    self.logger.warning(
                        "Partial SHORT close. remaining_qty=%.8f orderId=%s",
                        remaining,
                        fill["order_id"],
                    )
                else:
                    self.position = PositionState()
                self.logger.info("Closed SHORT qty=%.8f exit=%.8f reason=%s", filled_qty, fill_price, reason)
            else:
                self.logger.error(
                    "Short close order not filled orderId=%s status=%s filledQty=%.8f; position kept",
                    fill["order_id"],
                    order_status,
                    filled_qty,
                )

    async def health_loop(self) -> None:
        self.logger.info("Health loop started")
        while not self.stop_event.is_set():
            try:
                await asyncio.sleep(self.config.health_interval)
                if self.stop_event.is_set():
                    break

                ticker_price = await self.mexc.get_ticker_price(self.config.symbol)
                self.logger.info(
                    "Health OK symbol=%s ticker=%.8f latest_ws=%.8f buffer=%s position=%s",
                    self.config.symbol,
                    ticker_price,
                    self.feed.latest_price or 0.0,
                    len(self.strategy.prices),
                    self.position.side,
                )
            except asyncio.CancelledError:
                break
            except Exception as exc:
                self.logger.error("Health loop error: %s", exc)


def setup_logging(config: BotConfig) -> logging.Logger:
    logger = logging.getLogger("mexc_bot")
    logger.setLevel(getattr(logging, config.log_level, logging.INFO))
    logger.propagate = False

    if logger.handlers:
        return logger

    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)
    logger.addHandler(stream_handler)

    log_path = config.log_file
    try:
        log_dir = os.path.dirname(log_path)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
        file_handler = RotatingFileHandler(log_path, maxBytes=5 * 1024 * 1024, backupCount=5)
    except Exception:
        fallback = f"mexc-bot-{config.bot_instance_id}.log"
        file_handler = RotatingFileHandler(fallback, maxBytes=5 * 1024 * 1024, backupCount=5)
        logger.warning("Unable to use log path %s, using local file %s", log_path, fallback)

    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger


async def run_bot() -> None:
    env_file = os.getenv("BOT_ENV_FILE", ".env")
    load_dotenv_file(env_file)

    config = BotConfig.from_env()
    config.validate()

    logger = setup_logging(config)
    logger.info("Starting MEXC bot instance=%s symbol=%s", config.bot_instance_id, config.symbol)
    logger.info(
        "Linked exchange runtime resolution enabled=%s path=%s",
        config.resolve_exchange_from_backend,
        config.backend_runtime_path,
    )
    logger.info(
        "Strategy params MACD(%s,%s,%s) BB(length=%s,mult=%s) stop_loss_pct=%s risk_reward=%s tp_mode=%s trailing_enabled=%s trailing_tp_pct=%s trailing_activation_pct=%s",
        config.macd_fast,
        config.macd_slow,
        config.macd_signal,
        config.bb_length,
        config.bb_mult,
        config.stop_loss_pct,
        config.risk_reward,
        config.take_profit_mode,
        config.trailing_take_profit_enabled,
        config.trailing_take_profit_pct,
        config.trailing_take_profit_activation_pct,
    )

    bot = TradingBot(config, logger)

    loop = asyncio.get_running_loop()

    def handle_signal(sig_name: str) -> None:
        logger.info("Received %s, requesting shutdown", sig_name)
        bot.request_stop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, handle_signal, sig.name)
        except NotImplementedError:
            # add_signal_handler is not available on some platforms.
            pass

    try:
        await bot.run()
    finally:
        await bot.shutdown()


def main() -> int:
    try:
        asyncio.run(run_bot())
        return 0
    except ValueError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        print(f"Fatal error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
