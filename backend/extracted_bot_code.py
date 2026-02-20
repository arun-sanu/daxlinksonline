import os
import time
import math
import json
import threading
import sqlite3
from dataclasses import dataclass
from collections import deque
from typing import Optional, Dict, Any, List, Tuple

from flask import Flask, request, jsonify

try:
    import ccxt
except ImportError:
    ccxt = None

try:
    import websockets
    import asyncio
except ImportError:
    websockets = None
    asyncio = None


# =========================
# Hard-wired exchange spec (from your payload)
# =========================
@dataclass(frozen=True)
class MarketSpec:
    symbol_tv: str = "BTCUSDC"
    symbol_ccxt: str = "BTC/USDC"

    spot_only: bool = True

    base_step: float = 0.000001
    price_decimals: int = 2
    quote_amount_decimals: int = 1

    max_quote_limit: float = 2_000_000
    max_quote_market: float = 100_000

    bid_multiplier_up: float = 0.02
    ask_multiplier_down: float = 0.02

    min_sell_usdc: float = 1.0

SPEC = MarketSpec()


# =========================
# Helpers
# =========================
def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))

def floor_to_step(x: float, step: float) -> float:
    return math.floor(x / step) * step if step > 0 else x

def ceil_to_step(x: float, step: float) -> float:
    return math.ceil(x / step) * step if step > 0 else x

def round_price(p: float) -> float:
    return round(p, SPEC.price_decimals)

def round_quote_amount(q: float) -> float:
    return round(q, SPEC.quote_amount_decimals)

def clamp_limit_price(side: str, bid: float, ask: float, desired: float) -> float:
    side = side.upper()
    if side == "BUY":
        min_price = ask * (1.0 - SPEC.ask_multiplier_down)
        px = max(desired, min_price)
        return round_price(px)
    if side == "SELL":
        max_price = bid * (1.0 + SPEC.bid_multiplier_up)
        px = min(desired, max_price)
        return round_price(px)
    raise ValueError("side must be BUY or SELL")

def min_qty_for_min_sell_usdc(price: float) -> float:
    if price <= 0:
        return 0.0
    return ceil_to_step(SPEC.min_sell_usdc / price, SPEC.base_step)

def enforce_min_sell_notional(qty: float, price: float, pos_qty: float) -> float:
    if price <= 0:
        return 0.0
    qty = floor_to_step(qty, SPEC.base_step)
    if qty * price >= SPEC.min_sell_usdc:
        return qty
    min_needed = min_qty_for_min_sell_usdc(price)
    if min_needed <= pos_qty:
        return min_needed
    return 0.0


# =========================
# SQLite State
# =========================
class StateStore:
    def __init__(self, path="btc_bot_state.db"):
        self.path = path
        self._init()

    def _init(self):
        with sqlite3.connect(self.path) as con:
            cur = con.cursor()
            cur.execute("""
            CREATE TABLE IF NOT EXISTS position (
                symbol TEXT PRIMARY KEY,
                side TEXT NOT NULL,         -- FLAT / LONG
                qty REAL NOT NULL,
                avg_entry REAL NOT NULL,
                updated_at INTEGER NOT NULL
            )""")
            cur.execute("""
            CREATE TABLE IF NOT EXISTS orders (
                order_id TEXT PRIMARY KEY,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,         -- BUY / SELL
                type TEXT NOT NULL,         -- LIMIT
                price REAL NOT NULL,
                amount REAL NOT NULL,
                filled REAL NOT NULL,
                status TEXT NOT NULL,       -- OPEN / CLOSED / CANCELED / REJECTED
                purpose TEXT NOT NULL,      -- ENTRY / EXIT
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )""")
            con.commit()

    # ---- Position ----
    def get_position(self, symbol: str) -> Dict[str, Any]:
        with sqlite3.connect(self.path) as con:
            cur = con.cursor()
            cur.execute("SELECT side, qty, avg_entry FROM position WHERE symbol=?", (symbol,))
            row = cur.fetchone()
            if not row:
                return {"side": "FLAT", "qty": 0.0, "avg_entry": 0.0}
            return {"side": row[0], "qty": float(row[1]), "avg_entry": float(row[2])}

    def set_position(self, symbol: str, side: str, qty: float, avg_entry: float):
        with sqlite3.connect(self.path) as con:
            cur = con.cursor()
            cur.execute("""
            INSERT INTO position(symbol, side, qty, avg_entry, updated_at)
            VALUES(?,?,?,?,?)
            ON CONFLICT(symbol) DO UPDATE SET
              side=excluded.side, qty=excluded.qty, avg_entry=excluded.avg_entry, updated_at=excluded.updated_at
            """, (symbol, side, float(qty), float(avg_entry), int(time.time())))
            con.commit()

    # ---- Orders ----
    def upsert_order(self, od: Dict[str, Any]):
        with sqlite3.connect(self.path) as con:
            cur = con.cursor()
            cur.execute("""
            INSERT INTO orders(order_id, symbol, side, type, price, amount, filled, status, purpose, created_at, updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(order_id) DO UPDATE SET
              price=excluded.price,
              amount=excluded.amount,
              filled=excluded.filled,
              status=excluded.status,
              updated_at=excluded.updated_at
            """, (
                od["order_id"], od["symbol"], od["side"], od["type"], float(od["price"]),
                float(od["amount"]), float(od["filled"]), od["status"], od["purpose"],
                int(od["created_at"]), int(time.time())
            ))
            con.commit()

    def get_open_orders(self, symbol: str) -> List[Dict[str, Any]]:
        with sqlite3.connect(self.path) as con:
            con.row_factory = sqlite3.Row
            cur = con.cursor()
            cur.execute("""
            SELECT * FROM orders
            WHERE symbol=? AND status='OPEN'
            ORDER BY created_at ASC
            """, (symbol,))
            rows = cur.fetchall()
            return [dict(r) for r in rows]

    def get_order(self, order_id: str) -> Optional[Dict[str, Any]]:
        with sqlite3.connect(self.path) as con:
            con.row_factory = sqlite3.Row
            cur = con.cursor()
            cur.execute("SELECT * FROM orders WHERE order_id=?", (order_id,))
            row = cur.fetchone()
            return dict(row) if row else None


# =========================
# Exchange (CCXT REST)
# =========================
class Exchange:
    def __init__(self):
        if ccxt is None:
            raise RuntimeError("ccxt not installed. pip install ccxt")

        api_key = os.getenv("API_KEY")
        api_secret = os.getenv("API_SECRET")
        if not api_key or not api_secret:
            raise RuntimeError("Set API_KEY and API_SECRET env vars")

        self.ex = ccxt.mexc({
            "apiKey": api_key,
            "secret": api_secret,
            "enableRateLimit": True,
        })
        self.ex.load_markets()

    def fetch_balance(self) -> Dict[str, Any]:
        return self.ex.fetch_balance()

    def fetch_ticker(self, symbol: str) -> Dict[str, Any]:
        return self.ex.fetch_ticker(symbol)

    def create_limit_buy(self, symbol: str, qty: float, price: float) -> Dict[str, Any]:
        return self.ex.create_limit_buy_order(symbol, qty, price)

    def create_limit_sell(self, symbol: str, qty: float, price: float) -> Dict[str, Any]:
        return self.ex.create_limit_sell_order(symbol, qty, price)

    def fetch_order(self, order_id: str, symbol: str) -> Dict[str, Any]:
        return self.ex.fetch_order(order_id, symbol)

    def cancel_order(self, order_id: str, symbol: str) -> Dict[str, Any]:
        return self.ex.cancel_order(order_id, symbol)


# =========================
# Live price + tick buffer
# =========================
class PriceState:
    def __init__(self):
        self.bid = 0.0
        self.ask = 0.0
        self.last = 0.0
        self.ts = 0.0

PRICE = PriceState()
TICKS = deque(maxlen=500)  # (ts, bid)

def on_price_update(bid: float, ask: float, last: float):
    now = time.time()
    if bid > 0: PRICE.bid = bid
    if ask > 0: PRICE.ask = ask
    if last > 0: PRICE.last = last
    PRICE.ts = now
    b = PRICE.bid or PRICE.last
    if b > 0:
        TICKS.append((now, b))


# =========================
# Dynamic ladder / cooldown / momentum / trailing
# =========================
def avg_return(window_sec: float) -> float:
    if len(TICKS) < 10:
        return 0.0
    now, newest = TICKS[-1]
    oldest = None
    for ts, px in reversed(TICKS):
        if now - ts >= window_sec:
            oldest = px
            break
    if oldest is None or oldest <= 0:
        return 0.0
    return (newest - oldest) / oldest

def momentum_accel() -> float:
    return avg_return(0.5) - avg_return(2.0)

def compute_metrics(bid: float, ask: float, avg_entry: float, pos_qty: float) -> Dict[str, float]:
    if bid <= 0 or avg_entry <= 0 or pos_qty <= 0:
        return {"pnlPct": 0.0, "spreadPct": 0.0, "volProxy": 0.0, "profit_strength": 0.0, "market_noise": 0.0}
    pnlPct = (bid - avg_entry) / avg_entry * 100.0
    spread = max(0.0, ask - bid) if ask > 0 else 0.0
    spreadPct = (spread / bid) if bid > 0 else 0.0
    volProxy = spreadPct
    profit_strength = clamp(pnlPct / 2.0, 0.0, 2.0)
    market_noise = clamp(volProxy / 0.002, 0.0, 3.0)
    return {"pnlPct": pnlPct, "spreadPct": spreadPct, "volProxy": volProxy, "profit_strength": profit_strength, "market_noise": market_noise}

def compute_dynamic_cooldown_ms(m: Dict[str, float]) -> int:
    cooldown = 1200.0 - 300.0 * m["profit_strength"] + 250.0 * m["market_noise"]
    return int(clamp(cooldown, 250.0, 2500.0))

def build_dynamic_ladder(m: Dict[str, float]) -> List[Tuple[float, float]]:
    ps, mn = m["profit_strength"], m["market_noise"]
    stepPct = clamp(0.25 + 0.15 * mn, 0.25, 0.80)
    rungs = int(clamp(round(3 + ps * 3 - mn), 2, 8))
    startPct = clamp(0.25 + 0.10 * mn, 0.25, 0.60)
    totalFrac = clamp(0.55 + 0.20 * ps, 0.55, 0.95)
    aggressiveness = clamp(0.55 + 0.25 * ps - 0.10 * mn, 0.35, 0.85)

    weights = []
    rem = 1.0
    for _ in range(rungs):
        w = rem * aggressiveness
        weights.append(w)
        rem -= w
        if rem <= 0.001:
            break
    s = sum(weights)
    weights = [w / s for w in weights]

    ladder = []
    for i, w in enumerate(weights):
        ladder.append((round(startPct + stepPct * i, 2), w * totalFrac))
    ladder.append((round(startPct + stepPct * (len(weights) + 1), 2), 1.0))
    return ladder

def trailing_params(m: Dict[str, float]) -> Tuple[float, float, float]:
    mn = m["market_noise"]
    trail_start = clamp(0.80 + 0.20 * mn, 0.8, 1.6)
    trail_slack = clamp(0.25 + 0.15 * mn, 0.25, 0.80)
    pullback = clamp(0.35 + 0.20 * mn, 0.35, 1.00)
    return trail_start, trail_slack, pullback

def shift_ladder_up(base_ladder: List[Tuple[float, float]], peak_pnl: float, trail_slack: float) -> List[Tuple[float, float]]:
    if not base_ladder:
        return base_ladder
    first = base_ladder[0][0]
    offset = max(0.0, peak_pnl - (first + trail_slack))
    if offset <= 0:
        return base_ladder
    return [(round(r + offset, 2), f) for (r, f) in base_ladder]

def should_hold_for_next_rung(pnl_pct: float, rung_pct: float, next_rung_pct: float, spread_pct: float, skipped_once: set) -> bool:
    ACCEL_TH = 0.0006
    SPREAD_MAX = 0.0015
    MIN_PROFIT = 0.30
    if pnl_pct < MIN_PROFIT: return False
    if spread_pct > SPREAD_MAX: return False
    if pnl_pct >= next_rung_pct: return False
    if rung_pct in skipped_once: return False
    return momentum_accel() >= ACCEL_TH


# =========================
# Exit State
# =========================
class ExitState:
    def __init__(self):
        self.armed = False
        self.fired_rungs = set()
        self.skipped_once = set()
        self.active_plan = None          # dict with remaining/chunk/cooldowns
        self.pending_order_id = None     # only one active order at a time
        self.last_sell_ts = 0.0
        self.peak_pnl = 0.0

EXIT = ExitState()
BIG_PROFIT_PCT = 3.0


def build_chunk_plan(total_qty: float, price: float, vol_proxy: float) -> Optional[Dict[str, Any]]:
    if total_qty <= 0 or price <= 0:
        return None
    notional = total_qty * price
    if notional < 10:
        chunks = 1
    elif notional < 200:
        chunks = 3
    else:
        chunks = 6
    if vol_proxy > 0.02:
        chunks = min(12, chunks + 2)

    chunk_qty = total_qty / chunks
    min_chunk = min_qty_for_min_sell_usdc(price)
    chunk_qty = max(chunk_qty, min_chunk)
    chunk_qty = floor_to_step(chunk_qty, SPEC.base_step)
    if chunk_qty <= 0:
        return None

    chunks = max(1, int(math.floor(total_qty / chunk_qty)))
    return {
        "remaining": float(total_qty),
        "chunk_qty": float(chunk_qty),
        "delay_sec": 0.25 if vol_proxy > 0.02 else 0.8,
        "cooldown_ms": 1200,
        "order_timeout_sec": 6,   # if not filled in 6s, cancel/replace
        "reason": "LADDER",
    }


# =========================
# Bot core
# =========================
class Bot:
    def __init__(self, store: StateStore, ex: Exchange):
        self.store = store
        self.ex = ex
        self.symbol = SPEC.symbol_ccxt

    def _balance_free(self, bal: Dict[str, Any]) -> Tuple[float, float]:
        usdc = float((bal.get("USDC") or {}).get("free") or 0.0)
        btc = float((bal.get("BTC") or {}).get("free") or 0.0)
        return usdc, btc

    def _record_order(self, raw: Dict[str, Any], purpose: str) -> Dict[str, Any]:
        # Normalize CCXT order fields
        order_id = str(raw.get("id"))
        amount = float(raw.get("amount") or 0.0)
        filled = float(raw.get("filled") or 0.0)
        price = float(raw.get("price") or 0.0)
        side = str(raw.get("side") or "").upper()
        otype = str(raw.get("type") or "limit").upper()
        status = str(raw.get("status") or "open").upper()
        status = "OPEN" if status in ("OPEN", "NEW") else ("CLOSED" if status in ("CLOSED", "FILLED") else status)

        od = {
            "order_id": order_id,
            "symbol": self.symbol,
            "side": side,
            "type": otype,
            "price": price,
            "amount": amount,
            "filled": filled,
            "status": status if status in ("OPEN", "CLOSED", "CANCELED") else "OPEN",
            "purpose": purpose,
            "created_at": int(time.time()),
        }
        self.store.upsert_order(od)
        return od

    def on_webhook(self, side: str) -> Dict[str, Any]:
        side = side.upper().strip()
        if side not in ("BUY", "SELL"):
            return {"ok": False, "error": "side must be BUY or SELL"}

        pos = self.store.get_position(self.symbol)

        if side == "BUY":
            if pos["side"] == "LONG" and pos["qty"] > 0:
                return {"ok": True, "note": "already LONG; ignoring BUY"}

            bal = self.ex.fetch_balance()
            freeUSDC, _ = self._balance_free(bal)

            bid = PRICE.bid or PRICE.last
            ask = PRICE.ask or PRICE.last
            if ask <= 0:
                t = self.ex.fetch_ticker(self.symbol)
                bid = float(t.get("bid") or 0.0)
                ask = float(t.get("ask") or 0.0)
            if ask <= 0:
                return {"ok": False, "error": "no price available"}

            spend = min(freeUSDC * 0.50, SPEC.max_quote_limit)
            spend = round_quote_amount(spend)
            if spend <= 0:
                return {"ok": False, "error": "no USDC to buy"}

            buy_px = clamp_limit_price("BUY", bid, ask, ask)
            qty = floor_to_step(spend / buy_px, SPEC.base_step)
            if qty <= 0:
                return {"ok": False, "error": "qty computed 0"}

            raw = self.ex.create_limit_buy(self.symbol, qty, buy_px)
            od = self._record_order(raw, purpose="ENTRY")

            # For entry, position updates happen ONLY via fill handler.
            # Reset exit state.
            EXIT.armed = False
            EXIT.fired_rungs.clear()
            EXIT.skipped_once.clear()
            EXIT.active_plan = None
            EXIT.pending_order_id = None
            EXIT.last_sell_ts = 0.0
            EXIT.peak_pnl = 0.0

            return {"ok": True, "note": "BUY placed (await fill)", "order_id": od["order_id"], "qty": qty, "price": buy_px}

        if side == "SELL":
            if pos["side"] != "LONG" or pos["qty"] <= 0:
                return {"ok": True, "note": "no LONG to sell"}
            EXIT.armed = True
            return {"ok": True, "note": "SELL engine armed"}

        return {"ok": False, "error": "unreachable"}

    # =========================
    # Fill handling loop
    # =========================
    async def fill_reconciler_loop(self):
        """
        Poll open orders, update order status/filled, and update position ONLY from fills.
        """
        while True:
            await asyncio.sleep(0.5)

            open_orders = self.store.get_open_orders(self.symbol)
            if not open_orders:
                continue

            pos = self.store.get_position(self.symbol)

            for od in open_orders:
                order_id = od["order_id"]
                try:
                    live = self.ex.fetch_order(order_id, self.symbol)
                except Exception:
                    continue

                status_raw = str(live.get("status") or "open").lower()
                filled_now = float(live.get("filled") or 0.0)
                amount = float(live.get("amount") or od["amount"] or 0.0)
                avg_price = float(live.get("average") or live.get("price") or od["price"] or 0.0)

                # Normalize status
                if status_raw in ("closed", "filled"):
                    status = "CLOSED"
                elif status_raw in ("canceled", "cancelled"):
                    status = "CANCELED"
                else:
                    status = "OPEN"

                # Update order record
                self.store.upsert_order({
                    "order_id": order_id,
                    "symbol": self.symbol,
                    "side": od["side"],
                    "type": od["type"],
                    "price": float(od["price"]),
                    "amount": float(amount),
                    "filled": float(filled_now),
                    "status": status,
                    "purpose": od["purpose"],
                    "created_at": int(od["created_at"]),
                })

                # Apply newly filled delta to position
                filled_prev = float(od["filled"] or 0.0)
                delta = max(0.0, filled_now - filled_prev)
                if delta <= 0:
                    continue

                if od["purpose"] == "ENTRY" and od["side"] == "BUY":
                    # New/adding position: update weighted average entry
                    old_qty = pos["qty"] if pos["side"] == "LONG" else 0.0
                    old_avg = pos["avg_entry"] if pos["side"] == "LONG" else 0.0

                    new_qty = old_qty + delta
                    new_avg = ((old_qty * old_avg) + (delta * avg_price)) / new_qty if new_qty > 0 else 0.0
                    self.store.set_position(self.symbol, "LONG", new_qty, new_avg)
                    pos = self.store.get_position(self.symbol)

                if od["purpose"] == "EXIT" and od["side"] == "SELL":
                    # Reduce position
                    if pos["side"] == "LONG":
                        new_qty = max(0.0, pos["qty"] - delta)
                        if new_qty <= 0:
                            self.store.set_position(self.symbol, "FLAT", 0.0, 0.0)
                            EXIT.armed = False
                            EXIT.active_plan = None
                            EXIT.pending_order_id = None
                            EXIT.fired_rungs.clear()
                            EXIT.skipped_once.clear()
                            EXIT.peak_pnl = 0.0
                        else:
                            self.store.set_position(self.symbol, "LONG", new_qty, pos["avg_entry"])
                        pos = self.store.get_position(self.symbol)

                # If order closed/canceled, clear pending id if matches
                if status in ("CLOSED", "CANCELED") and EXIT.pending_order_id == order_id:
                    EXIT.pending_order_id = None

    # =========================
    # Exit engine loop (places sell orders; fills handled separately)
    # =========================
    async def exit_engine_loop(self):
        while True:
            await asyncio.sleep(0)

            pos = self.store.get_position(self.symbol)
            if pos["side"] != "LONG" or pos["qty"] <= 0 or pos["avg_entry"] <= 0:
                EXIT.armed = False
                EXIT.fired_rungs.clear()
                EXIT.skipped_once.clear()
                EXIT.active_plan = None
                EXIT.pending_order_id = None
                EXIT.peak_pnl = 0.0
                await asyncio.sleep(0.05)
                continue

            # If not armed and no plan, chill
            if not EXIT.armed and EXIT.active_plan is None:
                await asyncio.sleep(0.02)
                continue

            bid = PRICE.bid or PRICE.last
            ask = PRICE.ask or PRICE.last
            if bid <= 0:
                await asyncio.sleep(0.01)
                continue

            m = compute_metrics(bid, ask, pos["avg_entry"], pos["qty"])
            pnlPct = m["pnlPct"]
            EXIT.peak_pnl = max(EXIT.peak_pnl, pnlPct)

            cooldown_ms = compute_dynamic_cooldown_ms(m)

            # If there is a pending live order, do not place another.
            if EXIT.pending_order_id is not None:
                # If it’s stuck too long, cancel and replace.
                od = self.store.get_order(EXIT.pending_order_id)
                if od:
                    age = time.time() - float(od["created_at"])
                    timeout = (EXIT.active_plan or {}).get("order_timeout_sec", 6)
                    if age >= timeout and od["status"] == "OPEN":
                        try:
                            self.ex.cancel_order(EXIT.pending_order_id, self.symbol)
                        except Exception:
                            pass
                        # after cancel, reconciler will clear pending id
                await asyncio.sleep(0.02)
                continue

            # Sanity guardrail: big profit => full exit plan
            if pnlPct >= BIG_PROFIT_PCT:
                EXIT.skipped_once.clear()
                plan = build_chunk_plan(pos["qty"], bid, m["volProxy"])
                if plan:
                    plan["cooldown_ms"] = max(250, int(cooldown_ms * 0.5))
                    plan["reason"] = "SANITY_BIG_PROFIT_EXIT"
                    EXIT.active_plan = plan
                EXIT.armed = True

            # If plan exists, place next chunk (one order at a time)
            if EXIT.active_plan is not None:
                now = time.time()
                plan = EXIT.active_plan

                if EXIT.last_sell_ts > 0:
                    if (now - EXIT.last_sell_ts) * 1000 < plan.get("cooldown_ms", cooldown_ms):
                        await asyncio.sleep(0.01)
                        continue
                    if (now - EXIT.last_sell_ts) < plan.get("delay_sec", 0.8):
                        await asyncio.sleep(0.01)
                        continue

                remaining = float(plan["remaining"])
                if remaining <= 0:
                    EXIT.active_plan = None
                    await asyncio.sleep(0.01)
                    continue

                qty = min(float(plan["chunk_qty"]), remaining, pos["qty"])
                qty = enforce_min_sell_notional(qty, bid, pos["qty"])
                if qty <= 0:
                    EXIT.active_plan = None
                    await asyncio.sleep(0.02)
                    continue

                sell_px = clamp_limit_price("SELL", bid, ask, bid)
                try:
                    raw = self.ex.create_limit_sell(self.symbol, qty, sell_px)
                except Exception:
                    EXIT.active_plan = None
                    await asyncio.sleep(0.2)
                    continue

                od = self._record_order(raw, purpose="EXIT")
                EXIT.pending_order_id = od["order_id"]
                EXIT.last_sell_ts = now

                # Reduce plan remaining by ORDER AMOUNT (not filled yet). Fill reconciler will adjust position.
                plan["remaining"] = max(0.0, remaining - qty)
                EXIT.active_plan = plan
                continue

            # No plan: decide rung to fire
            base_ladder = build_dynamic_ladder(m)
            trail_start, trail_slack, pullback_th = trailing_params(m)

            trail_active = EXIT.peak_pnl >= trail_start
            ladder = shift_ladder_up(base_ladder, EXIT.peak_pnl, trail_slack) if trail_active else base_ladder

            pullback = EXIT.peak_pnl - pnlPct
            in_pullback = trail_active and (pullback >= pullback_th)
            if in_pullback:
                cooldown_ms = max(250, int(cooldown_ms * 0.5))

            # avoid churn on microscopic profit unless pullback mode
            if pnlPct < 0.20 and not in_pullback:
                await asyncio.sleep(0.02)
                continue

            for i, (rung_pct, frac) in enumerate(ladder):
                if pnlPct >= rung_pct and rung_pct not in EXIT.fired_rungs:
                    next_rung = ladder[i + 1][0] if i + 1 < len(ladder) else rung_pct + 999

                    if not in_pullback:
                        if should_hold_for_next_rung(pnlPct, rung_pct, next_rung, m["spreadPct"], EXIT.skipped_once):
                            EXIT.skipped_once.add(rung_pct)
                            break

                    EXIT.fired_rungs.add(rung_pct)

                    target_qty = pos["qty"] * frac
                    target_qty = enforce_min_sell_notional(target_qty, bid, pos["qty"])
                    if target_qty <= 0:
                        break

                    plan = build_chunk_plan(target_qty, bid, m["volProxy"])
                    if plan:
                        plan["cooldown_ms"] = cooldown_ms
                        plan["reason"] = "LADDER_RUNG"
                        EXIT.active_plan = plan
                    break

            await asyncio.sleep(0.002)

    async def ws_price_feed(self):
        """
        Replace with REAL MEXC spot WS details.
        Paste your WS message example and I’ll wire parsing precisely.
        """
        if websockets is None:
            raise RuntimeError("pip install websockets")

        WS_URL = "wss://YOUR_MEXC_SPOT_WS_ENDPOINT"

        async with websockets.connect(WS_URL, ping_interval=20) as ws:
            # TODO subscribe properly for BTCUSDC
            # await ws.send(json.dumps({...}))
            while True:
                msg = await ws.recv()
                data = json.loads(msg)

                bid = float(data.get("bid", 0) or 0)
                ask = float(data.get("ask", 0) or 0)
                last = float(data.get("last", 0) or 0)

                on_price_update(bid, ask, last)


# =========================
# Flask server
# =========================
app = Flask(__name__)
STORE = StateStore()
EX = None
BOT = None

@app.before_request
def init_once():
    global EX, BOT
    if EX is None:
        EX = Exchange()
    if BOT is None:
        BOT = Bot(STORE, EX)

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "ts": int(time.time())})

@app.route("/webhook", methods=["POST"])
def webhook():
    data = request.get_json(force=True, silent=False)
    symbol = (data.get("symbol") or "").upper().strip()
    side = (data.get("side") or "").upper().strip()

    if symbol != SPEC.symbol_tv:
        return jsonify({"ok": False, "error": f"unsupported symbol {symbol}"}), 400
    if side not in ("BUY", "SELL"):
        return jsonify({"ok": False, "error": "side must be BUY or SELL"}), 400

    res = BOT.on_webhook(side)
    return jsonify(res), (200 if res.get("ok") else 400)

def run_flask():
    app.run(host="0.0.0.0", port=8000, debug=False, use_reloader=False)


# =========================
# Main
# =========================
async def main():
    th = threading.Thread(target=run_flask, daemon=True)
    th.start()

    await asyncio.gather(
        BOT.ws_price_feed(),
        BOT.exit_engine_loop(),
        BOT.fill_reconciler_loop(),
    )

if __name__ == "__main__":
    if asyncio is None:
        raise RuntimeError("pip install websockets")
    EX = Exchange()
    BOT = Bot(STORE, EX)

    print("Bot running:")
    print("- Webhook: POST http://localhost:8000/webhook  {symbol:'BTCUSDC', side:'BUY'|'SELL'}")
    print("- Fill handling: ON (polls open orders, updates position only by fills)")
    print("- IMPORTANT: set real MEXC WS URL + subscribe + parsing in ws_price_feed().")

    asyncio.run(main())
