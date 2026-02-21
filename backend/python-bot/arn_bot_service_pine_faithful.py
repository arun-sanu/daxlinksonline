from __future__ import annotations

import math
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

Side = Literal['BUY', 'SELL']
Dir = Literal['LONG', 'SHORT']


class ArnSignal(BaseModel):
    # required
    signal_id: str
    symbol: str
    action: Literal['ENTRY', 'EXIT'] = 'ENTRY'
    direction: Dir

    # Pine uses close/current bar values
    price: float = Field(..., description='close price used for TP/SL calc')
    bar_index: int = Field(..., description='TradingView bar_index for cooldown logic')

    # Indicators/flags computed in Pine (or compute in TV alert message)
    atr: Optional[float] = Field(None, description='ATR(14)')
    volatility_spike: bool = False

    # Strategy inputs
    leverage: float = 1.0
    tp_percent: float = 1.0
    sl_atr_multiplier: float = 1.5
    investment_percentage: float = 90.0
    daily_loss_limit: float = 5.0
    cooldown_candles: int = 2

    # Optional: if your platform can provide equity, use it
    equity_quote: Optional[float] = None

    # Optional timestamp
    timestamp_ms: Optional[int] = None


@dataclass
class SymbolRules:
    min_notional: float
    step_size: float
    base_precision: int
    tick_size: float


@dataclass
class Balances:
    free_base: float
    free_quote: float


@dataclass
class OrderResult:
    order_id: str
    status: str
    raw: Dict[str, Any]


class ExchangeAdapter:
    """
    Plug your real MEXC integration here.

    For faithful Pine behavior:
    - ENTRY places market entry order
    - EXIT places reduce/close (market close) or sells spot balance
    - TP/SL placement:
        - Always place TP limit
        - Place SL only when volatility_spike == false (SL not-na)
    """

    def get_rules(self, symbol: str) -> SymbolRules:
        raise NotImplementedError

    def get_balances(self, symbol: str) -> Balances:
        raise NotImplementedError

    def get_last_price(self, symbol: str) -> float:
        raise NotImplementedError

    def close_all_positions(self, symbol: str, client_id: str) -> Dict[str, Any]:
        """Close everything for the symbol (spot: sell base; futures: close position)."""
        raise NotImplementedError

    def place_market(self, symbol: str, side: Side, qty_base: float, client_id: str) -> OrderResult:
        raise NotImplementedError

    def place_take_profit_reduce_only(
        self,
        symbol: str,
        direction: Dir,
        qty_base: float,
        tp_price: float,
        client_id: str,
    ) -> OrderResult:
        raise NotImplementedError

    def place_stop_loss_reduce_only(
        self,
        symbol: str,
        direction: Dir,
        qty_base: float,
        sl_price: float,
        client_id: str,
    ) -> OrderResult:
        raise NotImplementedError


def floor_to_step(qty: float, step: float) -> float:
    return math.floor(qty / step) * step if step > 0 else qty


def round_to_precision(x: float, p: int) -> float:
    return round(x, p)


class PineFaithfulState:
    """
    Mirrors Pine's state variables:
    - var float initial_equity = strategy.equity (set once)
    - var int last_trade_bar = na
    """

    def __init__(self):
        self.initial_equity_by_symbol: Dict[str, float] = {}
        self.last_trade_bar_by_symbol: Dict[str, Optional[int]] = {}


class ArnBotPineFaithful:
    def __init__(self, ex: ExchangeAdapter, tz_name: str = 'Asia/Kolkata'):
        self.ex = ex
        self.tz = ZoneInfo(tz_name)
        self.state = PineFaithfulState()
        self.seen_signal_ids: Dict[str, int] = {}

    def _dedupe(self, signal_id: str, now_ms: int) -> bool:
        ttl_ms = 10 * 60 * 1000
        prev = self.seen_signal_ids.get(signal_id)
        if prev and (now_ms - prev) < ttl_ms:
            return True
        self.seen_signal_ids[signal_id] = now_ms
        return False

    def _compute_equity(self, symbol: str, price: float, sig_equity: Optional[float]) -> float:
        if sig_equity is not None:
            return sig_equity
        bal = self.ex.get_balances(symbol)
        return bal.free_quote + bal.free_base * price

    def _in_cooldown(self, symbol: str, bar_index: int, cooldown_candles: int) -> bool:
        last_bar = self.state.last_trade_bar_by_symbol.get(symbol)
        if last_bar is None:
            return False
        return (bar_index - last_bar) <= cooldown_candles

    def _is_end_of_day_2359(self, now_ms: int) -> bool:
        dt = datetime.fromtimestamp(now_ms / 1000.0, tz=self.tz)
        return dt.hour == 23 and dt.minute == 59

    def handle(self, sig: ArnSignal) -> Dict[str, Any]:
        now_ms = sig.timestamp_ms or int(time.time() * 1000)

        if self._dedupe(sig.signal_id, now_ms):
            return {'ok': True, 'status': 'DUPLICATE_IGNORED'}

        rules = self.ex.get_rules(sig.symbol)
        price = sig.price or self.ex.get_last_price(sig.symbol)
        equity = self._compute_equity(sig.symbol, price, sig.equity_quote)

        # === Pine: var float initial_equity = strategy.equity (set ONCE)
        if sig.symbol not in self.state.initial_equity_by_symbol:
            self.state.initial_equity_by_symbol[sig.symbol] = equity

        initial_equity = self.state.initial_equity_by_symbol[sig.symbol]

        # === Pine: Daily Loss Limit Enforcement (NOT actually daily; compares to initial_equity forever)
        if equity < initial_equity * (1 - sig.daily_loss_limit / 100.0):
            closed = self.ex.close_all_positions(sig.symbol, client_id=f'{sig.signal_id}-CLOSEALL-LOSS')
            return {
                'ok': True,
                'status': 'CLOSE_ALL_DUE_TO_LOSS_LIMIT',
                'initial_equity': initial_equity,
                'equity': equity,
                'close': closed,
            }

        # === Pine: End-of-Day Close at 23:59
        if self._is_end_of_day_2359(now_ms):
            closed = self.ex.close_all_positions(sig.symbol, client_id=f'{sig.signal_id}-CLOSEALL-EOD')
            return {'ok': True, 'status': 'CLOSE_ALL_END_OF_DAY', 'close': closed}

        # === Cooldown Handling: candles after trade
        if self._in_cooldown(sig.symbol, sig.bar_index, sig.cooldown_candles):
            return {
                'ok': False,
                'status': 'IN_COOLDOWN',
                'last_trade_bar': self.state.last_trade_bar_by_symbol.get(sig.symbol),
                'bar_index': sig.bar_index,
            }

        # === EXIT handling: if platform emits EXIT, just close all (closest to Pine's close_all behavior)
        if sig.action == 'EXIT':
            closed = self.ex.close_all_positions(sig.symbol, client_id=f'{sig.signal_id}-CLOSEALL-EXIT')
            return {'ok': True, 'status': 'CLOSE_ALL_ON_EXIT_SIGNAL', 'close': closed}

        # === ENTRY handling
        # Pine requires ATR for SL calculation (even though SL may be na on vol spikes)
        if sig.atr is None and not sig.volatility_spike:
            return {'ok': False, 'status': 'ATR_REQUIRED_FOR_SL_WHEN_NOT_VOL_SPIKE'}

        # TP/SL exactly like Pine:
        if sig.direction == 'LONG':
            side: Side = 'BUY'
            tp_price = price * (1 + sig.tp_percent / 100.0)
            sl_price = None if sig.volatility_spike else (price - (sig.atr * sig.sl_atr_multiplier))
        else:
            # futures short entry is SELL; if spot, your adapter will need to reject/route accordingly
            side = 'SELL'
            tp_price = price * (1 - sig.tp_percent / 100.0)
            sl_price = None if sig.volatility_spike else (price + (sig.atr * sig.sl_atr_multiplier))

        # Position sizing exactly like Pine:
        # investment_size = max(equity*investment_percentage, equity*0.01)
        investment_size = max(
            equity * (sig.investment_percentage / 100.0),
            equity * 0.01,
        )
        qty_raw = (investment_size / price) * sig.leverage

        qty = floor_to_step(qty_raw, rules.step_size)
        qty = round_to_precision(qty, rules.base_precision)

        min_notional = rules.min_notional
        if qty <= 0 or qty * price < min_notional:
            return {
                'ok': False,
                'status': 'QTY_BELOW_MIN_NOTIONAL_AFTER_ROUNDING',
                'qty': qty,
                'notional': qty * price,
                'min_notional': min_notional,
            }

        # Place entry
        entry = self.ex.place_market(sig.symbol, side, qty, client_id=sig.signal_id)

        # Place TP always (Pine always sets limit = tp_level)
        tp = self.ex.place_take_profit_reduce_only(
            sig.symbol,
            sig.direction,
            qty,
            tp_price,
            client_id=f'{sig.signal_id}-TP',
        )

        # Place SL only if not volatility spike (Pine sets stop=na when spike)
        sl_res = None
        if sl_price is not None:
            sl_res = self.ex.place_stop_loss_reduce_only(
                sig.symbol,
                sig.direction,
                qty,
                sl_price,
                client_id=f'{sig.signal_id}-SL',
            )

        # Update Pine-like state: last_trade_bar := bar_index
        self.state.last_trade_bar_by_symbol[sig.symbol] = sig.bar_index

        return {
            'ok': True,
            'status': 'ENTRY_SENT_PINE_FAITHFUL',
            'initial_equity': initial_equity,
            'equity': equity,
            'qty': qty,
            'tp_price': tp_price,
            'sl_price': sl_price,  # will be None when volatility_spike == true
            'entry': entry.raw,
            'tp': tp.raw,
            'sl': None if sl_res is None else sl_res.raw,
        }


# ------------------- FastAPI server -------------------

app = FastAPI(title='ARN Bot (Pine Faithful)', version='1.0')

BOT: Optional[ArnBotPineFaithful] = None


@app.on_event('startup')
def startup() -> None:
    global BOT

    # Replace with your real MEXC adapter.
    class DummyMexc(ExchangeAdapter):
        def get_rules(self, symbol: str) -> SymbolRules:
            # Example LTC step/precision, replace with real exchange filters
            return SymbolRules(min_notional=1.0, step_size=0.01, base_precision=2, tick_size=0.0001)

        def get_balances(self, symbol: str) -> Balances:
            return Balances(free_base=10.0, free_quote=300.0)

        def get_last_price(self, symbol: str) -> float:
            return 80.0

        def close_all_positions(self, symbol: str, client_id: str) -> Dict[str, Any]:
            return {'closed': True, 'symbol': symbol, 'client_id': client_id}

        def place_market(self, symbol: str, side: Side, qty_base: float, client_id: str) -> OrderResult:
            return OrderResult(
                order_id=f'dummy-entry-{client_id}',
                status='FILLED',
                raw={'symbol': symbol, 'side': side, 'qty': qty_base, 'client_id': client_id},
            )

        def place_take_profit_reduce_only(
            self,
            symbol: str,
            direction: Dir,
            qty_base: float,
            tp_price: float,
            client_id: str,
        ) -> OrderResult:
            return OrderResult(
                order_id=f'dummy-tp-{client_id}',
                status='NEW',
                raw={'symbol': symbol, 'tp_price': tp_price, 'qty': qty_base, 'reduce_only': True},
            )

        def place_stop_loss_reduce_only(
            self,
            symbol: str,
            direction: Dir,
            qty_base: float,
            sl_price: float,
            client_id: str,
        ) -> OrderResult:
            return OrderResult(
                order_id=f'dummy-sl-{client_id}',
                status='NEW',
                raw={'symbol': symbol, 'sl_price': sl_price, 'qty': qty_base, 'reduce_only': True},
            )

    BOT = ArnBotPineFaithful(ex=DummyMexc(), tz_name='Asia/Kolkata')


@app.post('/signal')
async def signal(req: Request) -> Dict[str, Any]:
    try:
        payload = await req.json()
        sig = ArnSignal(**payload)
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    assert BOT is not None
    return BOT.handle(sig)
