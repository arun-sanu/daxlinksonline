import json
import math
import os
import time
from datetime import datetime, timedelta, timezone

import ccxt
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request

load_dotenv()

app = FastAPI(title='ARN Limit-Only Bot (TradingView -> MEXC)')

# -----------------------------
# Config
# -----------------------------
MEXC_API_KEY = os.getenv('MEXC_API_KEY', '')
MEXC_API_SECRET = os.getenv('MEXC_API_SECRET', '')

SYMBOL_DEFAULT = os.getenv('SYMBOL_DEFAULT', 'BTC/USDC')
MIN_QUOTE_QTY = float(os.getenv('MIN_QUOTE_QTY', '1.05'))
DAILY_LOSS_LIMIT_PCT = float(os.getenv('DAILY_LOSS_LIMIT_PCT', '5.0'))
COOLDOWN_SECONDS = int(os.getenv('COOLDOWN_SECONDS', '120'))

ENTRY_TTL_SECONDS = int(os.getenv('ENTRY_TTL_SECONDS', '20'))
LADDER_STEPS = int(os.getenv('LADDER_STEPS', '3'))
LADDER_STEP_BPS = int(os.getenv('LADDER_STEP_BPS', '3'))  # per step, in basis points

WEBHOOK_TOKEN = os.getenv('WEBHOOK_TOKEN', '')

# NOTE: user timezone is Asia/Kolkata (+05:30). We'll treat "day" in IST.
IST = timezone(timedelta(hours=5, minutes=30))

# -----------------------------
# Exchange init (MEXC spot)
# -----------------------------
if not MEXC_API_KEY or not MEXC_API_SECRET:
    print('WARNING: Missing MEXC_API_KEY or MEXC_API_SECRET. Bot will fail placing orders.')

exchange = ccxt.mexc(
    {
        'apiKey': MEXC_API_KEY,
        'secret': MEXC_API_SECRET,
        'enableRateLimit': True,
    }
)

# -----------------------------
# Small state store (in-memory)
# In production, persist to DB/Redis.
# -----------------------------
STATE = {
    'last_trade_ts': 0.0,
    'day_key': None,  # YYYY-MM-DD in IST
    'day_start_equity': None,  # quote-equity snapshot (USDC/USDT-ish)
}


# -----------------------------
# Helpers
# -----------------------------
def now_ist() -> datetime:
    return datetime.now(tz=IST)


def day_key_ist() -> str:
    return now_ist().strftime('%Y-%m-%d')


def clamp_min_quote(q: float) -> float:
    return max(q, MIN_QUOTE_QTY)


def bps_to_mult(bps: int) -> float:
    return bps / 10000.0


def safe_float(x, name='value') -> float:
    try:
        return float(x)
    except Exception as exc:
        raise ValueError(f'Invalid {name}: {x}') from exc


def require_token(given: str):
    if not WEBHOOK_TOKEN:
        # If token is missing, block trading for safety.
        raise HTTPException(status_code=500, detail='WEBHOOK_TOKEN not set on server.')
    if given != WEBHOOK_TOKEN:
        raise HTTPException(status_code=401, detail='Invalid token.')


def normalize_symbol(tv_symbol: str) -> str:
    """
    TradingView sends syminfo.ticker like 'BTCUSDC' sometimes.
    CCXT expects 'BTC/USDC'. We try a sane conversion.
    """
    if '/' in tv_symbol:
        return tv_symbol.upper()

    s = tv_symbol.upper().strip()
    for quote in ['USDC', 'USDT', 'USD', 'INR', 'BTC', 'ETH']:
        if s.endswith(quote) and len(s) > len(quote):
            base = s[: -len(quote)]
            return f'{base}/{quote}'
    return SYMBOL_DEFAULT


def fetch_quote_equity(symbol: str) -> float:
    """
    Estimate "equity" in quote currency for daily loss limit.
    For spot: quote free + base free * last price (rough).
    """
    bal = exchange.fetch_balance()
    base, quote = symbol.split('/')

    free_quote = float(bal.get(quote, {}).get('free', 0.0) or 0.0)
    free_base = float(bal.get(base, {}).get('free', 0.0) or 0.0)

    ticker = exchange.fetch_ticker(symbol)
    last = float(ticker.get('last') or ticker.get('close') or 0.0)
    if last <= 0:
        return free_quote

    return free_quote + (free_base * last)


def ensure_day_reset(symbol: str):
    """
    Daily reset like Pine "newDay".
    """
    dk = day_key_ist()
    if STATE['day_key'] != dk:
        eq = fetch_quote_equity(symbol)
        STATE['day_key'] = dk
        STATE['day_start_equity'] = eq


def hit_daily_loss(symbol: str) -> bool:
    ensure_day_reset(symbol)
    start_eq = STATE['day_start_equity']
    if start_eq is None:
        return False
    eq = fetch_quote_equity(symbol)
    threshold = start_eq * (1.0 - DAILY_LOSS_LIMIT_PCT / 100.0)
    return eq < threshold


def in_cooldown() -> bool:
    return (time.time() - STATE['last_trade_ts']) < COOLDOWN_SECONDS


def get_market_filters(symbol: str):
    """
    Pull precision / limits from market data (min amount, step size).
    CCXT markets include precision and limits for many exchanges.
    """
    exchange.load_markets()
    market = exchange.market(symbol)
    precision_amount = market.get('precision', {}).get('amount', None)
    limits_amount_min = (market.get('limits', {}).get('amount', {}) or {}).get('min', None)
    return precision_amount, limits_amount_min


def quantize_amount(symbol: str, amount: float) -> float:
    precision_amount, limits_min = get_market_filters(symbol)

    if precision_amount is not None:
        fmt = '{:0.' + str(int(precision_amount)) + 'f}'
        amount = float(fmt.format(amount))

    if limits_min is not None and amount < float(limits_min):
        return 0.0

    return amount


def wait_for_fill(symbol: str, order_id: str, ttl: int):
    """
    Poll order until filled or ttl expires.
    """
    deadline = time.time() + ttl
    while time.time() < deadline:
        order = exchange.fetch_order(order_id, symbol)
        status = (order.get('status') or '').lower()
        if status in ['closed', 'filled']:
            return order
        if status in ['canceled', 'rejected', 'expired']:
            return None
        time.sleep(1.0)
    return None


def cancel_order_safely(symbol: str, order_id: str):
    try:
        exchange.cancel_order(order_id, symbol)
    except Exception:
        pass


def place_limit_entry(symbol: str, side: str, quote_qty: float, limit_price: float) -> dict:
    """
    Place entry as LIMIT only.
    side: BUY/SELL (TradingView payload)
    """
    if limit_price <= 0:
        raise ValueError('limitPrice must be > 0')

    base_amount = quote_qty / limit_price
    base_amount = quantize_amount(symbol, base_amount)

    if base_amount <= 0:
        raise ValueError(f'Computed base amount too small after quantization: {base_amount}')

    ccxt_side = 'buy' if side.upper() == 'BUY' else 'sell'
    return exchange.create_order(symbol, 'limit', ccxt_side, base_amount, limit_price)


def place_take_profit(
    symbol: str,
    entry_side: str,
    filled_amount: float,
    tp_percent: float,
    entry_price: float,
) -> dict:
    """
    TP is a plain limit order opposite side.
    """
    if tp_percent <= 0:
        raise ValueError('tpPercent must be > 0')
    if entry_price <= 0:
        raise ValueError('entry_price must be > 0')

    if entry_side.upper() == 'BUY':
        tp_price = entry_price * (1.0 + tp_percent / 100.0)
        side = 'sell'
    else:
        tp_price = entry_price * (1.0 - tp_percent / 100.0)
        side = 'buy'

    filled_amount = quantize_amount(symbol, filled_amount)
    return exchange.create_order(symbol, 'limit', side, filled_amount, tp_price)


def place_stop_loss_stop_limit(
    symbol: str,
    entry_side: str,
    filled_amount: float,
    sl_atr_mult: float,
    approx_atr: float,
    entry_price: float,
):
    """
    Uses ATR-based SL approximation from recent candles.
    """
    if sl_atr_mult <= 0 or approx_atr <= 0 or entry_price <= 0:
        return None

    if entry_side.upper() == 'BUY':
        stop_price = entry_price - (approx_atr * sl_atr_mult)
        limit_price = stop_price * 0.999
        side = 'sell'
    else:
        stop_price = entry_price + (approx_atr * sl_atr_mult)
        limit_price = stop_price * 1.001
        side = 'buy'

    filled_amount = quantize_amount(symbol, filled_amount)
    params = {'stopPrice': stop_price}

    try:
        return exchange.create_order(symbol, 'limit', side, filled_amount, limit_price, params)
    except Exception:
        return None


def approx_atr_14(symbol: str) -> float:
    """
    Lightweight ATR approximation using OHLCV.
    """
    try:
        ohlcv = exchange.fetch_ohlcv(symbol, timeframe='1m', limit=20)
        if not ohlcv or len(ohlcv) < 15:
            return 0.0

        trs = []
        prev_close = None
        for _, _open, high, low, close, _volume in ohlcv:
            if prev_close is None:
                tr = high - low
            else:
                tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
            trs.append(tr)
            prev_close = close

        return sum(trs[-14:]) / 14.0
    except Exception:
        return 0.0


# -----------------------------
# Core execution
# -----------------------------
def execute_signal(payload: dict) -> dict:
    tv_symbol = payload.get('symbol') or SYMBOL_DEFAULT
    symbol = normalize_symbol(tv_symbol)

    if hit_daily_loss(symbol):
        return {'ok': False, 'reason': 'Daily loss limit hit. Trading halted for today.'}

    if in_cooldown():
        return {'ok': False, 'reason': 'Cooldown active. Skipping trade.'}

    side = (payload.get('side') or '').upper()
    if side not in ['BUY', 'SELL']:
        return {'ok': False, 'reason': f'Invalid side: {side}'}

    quote_qty = clamp_min_quote(safe_float(payload.get('quoteQty', MIN_QUOTE_QTY), 'quoteQty'))
    limit_price = safe_float(payload.get('limitPrice', 0), 'limitPrice')

    tp_percent = safe_float(payload.get('tpPercent', 1.0), 'tpPercent')
    sl_atr_mult = safe_float(payload.get('slAtrMult', 1.5), 'slAtrMult')

    step_mult = bps_to_mult(LADDER_STEP_BPS)
    last_order = None
    filled = None

    for step in range(LADDER_STEPS):
        if step > 0:
            if side == 'BUY':
                limit_price = limit_price * (1.0 + step_mult)
            else:
                limit_price = limit_price * (1.0 - step_mult)

        last_order = place_limit_entry(symbol, side, quote_qty, limit_price)
        order_id = last_order.get('id')

        filled = wait_for_fill(symbol, order_id, ENTRY_TTL_SECONDS)
        if filled:
            break

        cancel_order_safely(symbol, order_id)

    if not filled:
        return {'ok': False, 'reason': 'Entry not filled after ladder attempts.', 'lastOrder': last_order}

    STATE['last_trade_ts'] = time.time()

    avg_price = float(filled.get('average') or filled.get('price') or limit_price)
    filled_amount = float(filled.get('filled') or filled.get('amount') or 0.0)

    tp_order = place_take_profit(symbol, side, filled_amount, tp_percent, avg_price)
    atr = approx_atr_14(symbol)
    sl_order = place_stop_loss_stop_limit(symbol, side, filled_amount, sl_atr_mult, atr, avg_price)

    return {
        'ok': True,
        'symbol': symbol,
        'entry': {
            'id': filled.get('id'),
            'side': side,
            'avgPrice': avg_price,
            'filledAmount': filled_amount,
        },
        'tp': {'id': tp_order.get('id'), 'price': tp_order.get('price')},
        'sl': (
            {'id': sl_order.get('id')}
            if sl_order
            else {
                'id': None,
                'note': 'Stop-limit not supported via CCXT params; add monitor loop or native MEXC conditional order params.',
            }
        ),
        'atrApprox': atr,
    }


# -----------------------------
# Webhook endpoint
# -----------------------------
@app.post('/webhook')
async def webhook(request: Request, token: str = ''):
    require_token(token)

    try:
        body = await request.body()
        data = json.loads(body.decode('utf-8'))
    except Exception as exc:
        raise HTTPException(status_code=400, detail='Invalid JSON body.') from exc

    if 'side' not in data or 'limitPrice' not in data:
        raise HTTPException(status_code=400, detail='Missing required fields: side, limitPrice.')

    try:
        result = execute_signal(data)
        return result
    except ccxt.BaseError as error:
        return {'ok': False, 'error': 'exchange_error', 'detail': str(error)}
    except Exception as error:
        return {'ok': False, 'error': 'bot_error', 'detail': str(error)}
