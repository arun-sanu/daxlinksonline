import json
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

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
BACKEND_URL = os.getenv('BACKEND_URL', 'http://localhost:8000').strip().rstrip('/')
BACKEND_RUNTIME_PATH = os.getenv('BACKEND_RUNTIME_PATH', '/api/v1/internal/bot/runtime-config').strip()
BACKEND_ORDER_RESULT_PATH = os.getenv('BACKEND_ORDER_RESULT_PATH', '/api/v1/internal/bot/order-result').strip()
INTERNAL_BOT_TOKEN = os.getenv('INTERNAL_BOT_TOKEN', '').strip()
BOT_INSTANCE_ID = os.getenv('BOT_INSTANCE_ID', '').strip()
RESOLVE_EXCHANGE_FROM_BACKEND = str(os.getenv('RESOLVE_EXCHANGE_FROM_BACKEND', 'true')).strip().lower() in {
    '1',
    'true',
    'yes',
    'on',
}
REPORT_TO_BACKEND = str(os.getenv('REPORT_TO_BACKEND', 'true')).strip().lower() in {'1', 'true', 'yes', 'on'}
RUNTIME_RETRIES = int(os.getenv('RUNTIME_RETRIES', '3'))
REQUEST_TIMEOUT = int(os.getenv('REQUEST_TIMEOUT', '20'))
RUNTIME_REFRESH_SECONDS = int(os.getenv('RUNTIME_REFRESH_SECONDS', '15'))

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
if not RESOLVE_EXCHANGE_FROM_BACKEND and (not MEXC_API_KEY or not MEXC_API_SECRET):
    print('WARNING: Missing MEXC_API_KEY or MEXC_API_SECRET. Bot will fail placing orders.')


def build_exchange(api_key: str, api_secret: str):
    return ccxt.mexc(
        {
            'apiKey': api_key,
            'secret': api_secret,
            'enableRateLimit': True,
        }
    )


exchange = build_exchange(MEXC_API_KEY, MEXC_API_SECRET)
EXCHANGE_STATE = {
    'api_key': MEXC_API_KEY,
    'api_secret': MEXC_API_SECRET,
}
RUNTIME_CACHE = {
    'fetched_at': 0.0,
    'runtime': None,
}

# -----------------------------
# Small state store (in-memory)
# In production, persist to DB/Redis.
# -----------------------------
STATE = {
    'last_trade_ts': 0.0,
    'last_trade_bar_by_symbol': {},
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


def clamp_min_quote(q: float, min_quote_qty: float) -> float:
    return max(q, min_quote_qty)


def bps_to_mult(bps: int) -> float:
    return bps / 10000.0


def safe_float(x, name='value') -> float:
    try:
        return float(x)
    except Exception as exc:
        raise ValueError(f'Invalid {name}: {x}') from exc


def safe_float_or(value, fallback: float) -> float:
    try:
        return float(value)
    except Exception:
        return float(fallback)


def safe_int_or(value, fallback: int) -> int:
    try:
        return int(float(value))
    except Exception:
        return int(fallback)


def safe_bool(x, fallback=False) -> bool:
    if isinstance(x, bool):
        return x
    if isinstance(x, (int, float)):
        return x != 0
    text = str(x or '').strip().lower()
    if text in ['true', '1', 'yes', 'on']:
        return True
    if text in ['false', '0', 'no', 'off']:
        return False
    return fallback


def pick_first(payload: dict, keys: list[str], fallback=None):
    for key in keys:
        if key in payload and payload.get(key) is not None:
            return payload.get(key)
    return fallback


def compact_symbol(symbol: str) -> str:
    return str(symbol or '').replace('/', '').upper()


def runtime_rule_pick(runtime_rules: dict[str, Any] | None, keys: list[str], fallback=None):
    if not runtime_rules or not isinstance(runtime_rules, dict):
        return fallback
    code_parameters = runtime_rules.get('codeParameters') if isinstance(runtime_rules.get('codeParameters'), dict) else {}
    for key in keys:
        if key in runtime_rules and runtime_rules.get(key) is not None:
            return runtime_rules.get(key)
        if key in code_parameters and code_parameters.get(key) is not None:
            return code_parameters.get(key)
    return fallback


def normalize_symbol_to_slash(symbol: str) -> str:
    raw = str(symbol or '').strip().upper()
    if not raw:
        return SYMBOL_DEFAULT
    if '/' in raw:
        return raw
    return normalize_symbol(raw)


def runtime_endpoint_url() -> str:
    if not BACKEND_RUNTIME_PATH.startswith('/'):
        raise ValueError('BACKEND_RUNTIME_PATH must start with "/".')
    return f'{BACKEND_URL}{BACKEND_RUNTIME_PATH.rstrip("/")}/{BOT_INSTANCE_ID}'


def order_result_endpoint_url() -> str:
    if not BACKEND_ORDER_RESULT_PATH.startswith('/'):
        raise ValueError('BACKEND_ORDER_RESULT_PATH must start with "/".')
    return f'{BACKEND_URL}{BACKEND_ORDER_RESULT_PATH}'


def request_json(
    method: str,
    url: str,
    *,
    body: dict | None = None,
    require_auth: bool = True,
) -> tuple[int, dict]:
    headers = {'Content-Type': 'application/json'}
    encoded = None
    if body is not None:
        encoded = json.dumps(body).encode('utf-8')
    if require_auth:
        if not INTERNAL_BOT_TOKEN:
            raise ValueError('INTERNAL_BOT_TOKEN is required for backend integration.')
        headers.update(
            {
                'Authorization': f'Bearer {INTERNAL_BOT_TOKEN}',
                'X-Internal-Token': INTERNAL_BOT_TOKEN,
                'X-Bot-Token': INTERNAL_BOT_TOKEN,
            }
        )

    req = UrlRequest(url=url, method=method.upper(), headers=headers, data=encoded)
    with urlopen(req, timeout=max(1, REQUEST_TIMEOUT)) as response:
        status = int(getattr(response, 'status', 200) or 200)
        raw = response.read().decode('utf-8', errors='ignore')
        parsed = json.loads(raw) if raw else {}
        return status, parsed


def ensure_exchange_credentials(api_key: str, api_secret: str):
    global exchange
    if not api_key or not api_secret:
        raise ValueError('Missing exchange credentials.')

    if EXCHANGE_STATE['api_key'] == api_key and EXCHANGE_STATE['api_secret'] == api_secret:
        return

    exchange = build_exchange(api_key, api_secret)
    EXCHANGE_STATE['api_key'] = api_key
    EXCHANGE_STATE['api_secret'] = api_secret


def fetch_runtime_from_backend() -> dict:
    last_error = None
    for attempt in range(1, max(1, RUNTIME_RETRIES) + 1):
        try:
            status, payload = request_json('GET', runtime_endpoint_url(), require_auth=True)
            if 200 <= status < 300 and isinstance(payload, dict):
                return payload
            last_error = RuntimeError(f'Runtime request failed with status={status}')
        except (HTTPError, URLError, TimeoutError, ValueError, RuntimeError) as exc:
            last_error = exc
        if attempt < max(1, RUNTIME_RETRIES):
            time.sleep(min(2.0 * attempt, 5.0))
    raise RuntimeError(f'Unable to fetch runtime config: {last_error}')


def resolve_runtime(force: bool = False) -> dict | None:
    if not RESOLVE_EXCHANGE_FROM_BACKEND:
        return None

    if not BOT_INSTANCE_ID:
        raise ValueError('BOT_INSTANCE_ID is required when RESOLVE_EXCHANGE_FROM_BACKEND=true')

    now_ts = time.time()
    cached_runtime = RUNTIME_CACHE.get('runtime')
    fetched_at = float(RUNTIME_CACHE.get('fetched_at') or 0.0)
    if not force and cached_runtime and (now_ts - fetched_at) < max(1, RUNTIME_REFRESH_SECONDS):
        return cached_runtime

    runtime = fetch_runtime_from_backend()
    exchange_account = runtime.get('exchangeAccount') if isinstance(runtime.get('exchangeAccount'), dict) else {}
    venue = str(exchange_account.get('venue') or '').strip().lower()
    if venue and 'mexc' not in venue:
        raise ValueError(f'Unsupported linked exchange venue: {venue}')

    runtime_api_key = str(exchange_account.get('apiKey') or '').strip()
    runtime_api_secret = str(exchange_account.get('apiSecret') or '').strip()
    if runtime_api_key and runtime_api_secret:
        ensure_exchange_credentials(runtime_api_key, runtime_api_secret)
    else:
        ensure_exchange_credentials(MEXC_API_KEY, MEXC_API_SECRET)

    RUNTIME_CACHE['runtime'] = runtime
    RUNTIME_CACHE['fetched_at'] = now_ts
    return runtime


def runtime_meta(runtime: dict | None) -> tuple[dict, dict]:
    if not runtime or not isinstance(runtime, dict):
        return {}, {}
    runtime_entry = runtime.get('runtime') if isinstance(runtime.get('runtime'), dict) else {}
    runtime_rules = runtime_entry.get('rules') if isinstance(runtime_entry.get('rules'), dict) else {}
    bot_instance = runtime.get('botInstance') if isinstance(runtime.get('botInstance'), dict) else {}
    return runtime_rules, bot_instance


def report_order_to_backend(payload: dict) -> dict:
    if not REPORT_TO_BACKEND:
        return {'sent': False, 'reason': 'reporting_disabled'}
    if not INTERNAL_BOT_TOKEN:
        return {'sent': False, 'reason': 'missing_internal_token'}

    try:
        status, body = request_json('POST', order_result_endpoint_url(), body=payload, require_auth=True)
        return {'sent': 200 <= status < 300, 'status': status, 'body': body}
    except Exception as exc:
        return {'sent': False, 'error': str(exc)}


def build_backend_order_result_payload(
    signal_payload: dict,
    *,
    runtime: dict | None,
    symbol: str,
    side: str,
    entry_order: dict,
    tp_order: dict | None,
    sl_order: dict | None,
    avg_price: float,
    filled_amount: float,
    tp_price: float | None = None,
    sl_price: float | None = None,
) -> dict:
    timestamp_ms = int(time.time() * 1000)
    compact = compact_symbol(symbol)
    bot_instance = runtime.get('botInstance') if isinstance(runtime, dict) and isinstance(runtime.get('botInstance'), dict) else {}

    entry_id = str(entry_order.get('id') or f'entry-{timestamp_ms}')
    entry_status = str(entry_order.get('status') or 'filled').lower()
    execution_status = 'FILLED' if entry_status in {'closed', 'filled'} else entry_status.upper()

    normalized_signal = {
        'id': str(signal_payload.get('signal_id') or signal_payload.get('signalId') or f'sig-{timestamp_ms}'),
        'symbol': compact,
        'side': side,
        'quantity': filled_amount,
        'signal_price': avg_price,
        'strategy': 'ARN_LIMIT_ONLY',
        'meta': {
            'source': 'python_bot',
            'botInstanceId': BOT_INSTANCE_ID or bot_instance.get('id'),
            'workspaceId': bot_instance.get('workspaceId'),
            'botId': bot_instance.get('botId'),
        },
    }

    payload = {
        'signalId': normalized_signal['id'],
        'workspaceId': bot_instance.get('workspaceId'),
        'botId': bot_instance.get('botId'),
        'botInstanceId': BOT_INSTANCE_ID or bot_instance.get('id'),
        'symbol': compact,
        'side': side,
        'normalizedSignal': normalized_signal,
        'entryOrder': {
            'venue': 'mexc',
            'symbol': compact,
            'side': side,
            'type': 'LIMIT',
            'qty': filled_amount,
            'price': avg_price,
            'status': entry_status,
            'orderId': entry_id,
            'venueOrderId': entry_id,
            'executedAt': timestamp_ms,
        },
        'protection': {
            'sl': {'orderId': sl_order.get('id') if isinstance(sl_order, dict) else None, 'price': sl_price},
            'tp': {'orderId': tp_order.get('id') if isinstance(tp_order, dict) else None, 'price': tp_price},
        },
        'sizing': {
            'status': entry_status,
            'qtyRaw': filled_amount,
            'qtyFinal': filled_amount,
            'refPrice': avg_price,
            'slPrice': sl_price,
            'tpPrice': tp_price,
        },
        'executionResult': {
            'orderId': entry_id,
            'status': execution_status,
            'executedQty': filled_amount,
            'price': avg_price,
            'updateTime': timestamp_ms,
        },
        'rawPayload': {
            'signal': signal_payload,
            'entry': entry_order,
            'tp': tp_order,
            'sl': sl_order,
        },
        'meta': {
            'strategy': 'ARN_LIMIT_ONLY',
            'source': 'python_bot',
            'botInstanceId': BOT_INSTANCE_ID or bot_instance.get('id'),
            'workspaceId': bot_instance.get('workspaceId'),
            'botId': bot_instance.get('botId'),
        },
    }
    return payload


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


def hit_daily_loss(symbol: str, daily_loss_limit_pct: float) -> bool:
    ensure_day_reset(symbol)
    start_eq = STATE['day_start_equity']
    if start_eq is None:
        return False
    eq = fetch_quote_equity(symbol)
    threshold = start_eq * (1.0 - daily_loss_limit_pct / 100.0)
    return eq < threshold


def in_cooldown(symbol: str, cooldown_seconds: int, cooldown_candles: int, bar_index: int | None) -> bool:
    if (time.time() - STATE['last_trade_ts']) < cooldown_seconds:
        return True

    if bar_index is None or cooldown_candles <= 0:
        return False

    last_bar = STATE['last_trade_bar_by_symbol'].get(symbol)
    if last_bar is None:
        return False
    return (bar_index - last_bar) <= cooldown_candles


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


def derive_limit_price(side: str, payload: dict, symbol: str, slippage_bps: int) -> float:
    direct = pick_first(payload, ['limitPrice', 'limit_price'], None)
    if direct is not None:
        return safe_float(direct, 'limitPrice')

    # Pine uses close for MID/BID/ASK/CLOSE approximation in alert mode.
    ref = safe_float(pick_first(payload, ['price', 'close'], 0), 'price')
    if ref <= 0:
        ticker = exchange.fetch_ticker(symbol)
        ref = float(ticker.get('last') or ticker.get('close') or 0.0)
    if ref <= 0:
        raise ValueError('Unable to derive limitPrice from payload or ticker.')

    slip = bps_to_mult(slippage_bps)
    return ref * (1.0 - slip) if side == 'BUY' else ref * (1.0 + slip)


# -----------------------------
# Core execution
# -----------------------------
def execute_signal(payload: dict) -> dict:
    runtime = resolve_runtime(force=False)
    runtime_rules, runtime_bot_instance = runtime_meta(runtime)

    runtime_symbol = runtime_rule_pick(runtime_rules, ['symbol_default', 'symbol'], None) or runtime_bot_instance.get('symbol')
    tv_symbol = payload.get('symbol') or runtime_symbol or SYMBOL_DEFAULT
    symbol = normalize_symbol(tv_symbol)

    min_quote_default = safe_float_or(runtime_rule_pick(runtime_rules, ['min_quote_qty', 'minQuoteQty'], MIN_QUOTE_QTY), MIN_QUOTE_QTY)
    min_quote_qty = max(0.0, safe_float(pick_first(payload, ['minQuoteQty', 'min_quote_qty'], min_quote_default), 'minQuoteQty'))

    daily_loss_default = safe_float_or(
        runtime_rule_pick(runtime_rules, ['dailyLossLimit', 'daily_loss_limit', 'daily_loss_limit_pct'], DAILY_LOSS_LIMIT_PCT),
        DAILY_LOSS_LIMIT_PCT,
    )
    daily_loss_limit_pct = max(
        0.0,
        safe_float(
            pick_first(
                payload,
                ['dailyLossLimit', 'daily_loss_limit', 'daily_loss_limit_pct'],
                daily_loss_default,
            ),
            'dailyLossLimit',
        ),
    )

    cooldown_seconds_default = safe_int_or(
        runtime_rule_pick(runtime_rules, ['cooldownSeconds', 'cooldown_seconds'], COOLDOWN_SECONDS), COOLDOWN_SECONDS
    )
    cooldown_seconds = max(
        0,
        int(safe_float(pick_first(payload, ['cooldownSeconds', 'cooldown_seconds'], cooldown_seconds_default), 'cooldownSeconds')),
    )

    cooldown_candles_default = safe_int_or(runtime_rule_pick(runtime_rules, ['cooldownCandles', 'cooldown_candles'], 0), 0)
    cooldown_candles = max(
        0,
        int(safe_float(pick_first(payload, ['cooldownCandles', 'cooldown_candles'], cooldown_candles_default), 'cooldownCandles')),
    )
    bar_index_raw = pick_first(payload, ['barIndex', 'bar_index'], None)
    bar_index = int(safe_float(bar_index_raw, 'barIndex')) if bar_index_raw is not None else None

    entry_ttl_default = safe_int_or(runtime_rule_pick(runtime_rules, ['entryTtlSeconds', 'entry_ttl_seconds'], ENTRY_TTL_SECONDS), ENTRY_TTL_SECONDS)
    entry_ttl_seconds = max(
        1,
        int(safe_float(pick_first(payload, ['entryTtlSeconds', 'entry_ttl_seconds'], entry_ttl_default), 'entryTtlSeconds')),
    )

    ladder_steps_default = safe_int_or(runtime_rule_pick(runtime_rules, ['ladderSteps', 'ladder_steps'], LADDER_STEPS), LADDER_STEPS)
    ladder_steps = max(1, int(safe_float(pick_first(payload, ['ladderSteps', 'ladder_steps'], ladder_steps_default), 'ladderSteps')))

    ladder_step_default = safe_int_or(
        runtime_rule_pick(runtime_rules, ['ladderStepBps', 'ladder_step_bps'], LADDER_STEP_BPS), LADDER_STEP_BPS
    )
    ladder_step_bps = max(
        0,
        int(safe_float(pick_first(payload, ['ladderStepBps', 'ladder_step_bps'], ladder_step_default), 'ladderStepBps')),
    )

    limit_style_default = str(runtime_rule_pick(runtime_rules, ['limitStyle', 'limit_style'], 'MID') or 'MID').strip().upper()
    limit_style = str(pick_first(payload, ['limitStyle', 'limit_style'], limit_style_default) or limit_style_default).strip().upper()

    slippage_default = safe_int_or(runtime_rule_pick(runtime_rules, ['slippageBps', 'slippage_bps'], 0), 0)
    slippage_bps = max(0, int(safe_float(pick_first(payload, ['slippageBps', 'slippage_bps'], slippage_default), 'slippageBps')))

    if hit_daily_loss(symbol, daily_loss_limit_pct):
        return {'ok': False, 'reason': 'Daily loss limit hit. Trading halted for today.'}

    if in_cooldown(symbol, cooldown_seconds, cooldown_candles, bar_index):
        return {'ok': False, 'reason': 'Cooldown active. Skipping trade.'}

    side = (payload.get('side') or '').upper()
    if side not in ['BUY', 'SELL']:
        return {'ok': False, 'reason': f'Invalid side: {side}'}

    investment_default = safe_float_or(runtime_rule_pick(runtime_rules, ['investmentPercentage', 'investment_percentage'], 90.0), 90.0)
    investment_percentage = safe_float(
        pick_first(payload, ['investmentPercentage', 'investment_percentage'], investment_default), 'investmentPercentage'
    )
    investment_percentage = max(0.0, min(investment_percentage, 100.0))

    quote_qty_value = pick_first(payload, ['quoteQty', 'quote_qty'], None)
    if quote_qty_value is None:
        equity = fetch_quote_equity(symbol)
        investment_size_raw = equity * (investment_percentage / 100.0)
        investment_size = max(investment_size_raw, equity * 0.01)
        quote_qty = clamp_min_quote(investment_size, min_quote_qty)
    else:
        quote_qty = clamp_min_quote(safe_float(quote_qty_value, 'quoteQty'), min_quote_qty)

    limit_price = derive_limit_price(side, payload, symbol, slippage_bps)

    tp_default = safe_float_or(runtime_rule_pick(runtime_rules, ['tpPercent', 'tp_percent'], 1.0), 1.0)
    tp_percent = safe_float(pick_first(payload, ['tpPercent', 'tp_percent'], tp_default), 'tpPercent')

    sl_default = safe_float_or(
        runtime_rule_pick(runtime_rules, ['slAtrMult', 'sl_atr_mult', 'slAtrMultiplier', 'sl_atr_multiplier'], 1.5), 1.5
    )
    sl_atr_mult = safe_float(
        pick_first(payload, ['slAtrMult', 'sl_atr_mult', 'slAtrMultiplier', 'sl_atr_multiplier'], sl_default), 'slAtrMult'
    )
    atr_payload = pick_first(payload, ['atr'], None)
    atr_from_payload = safe_float(atr_payload, 'atr') if atr_payload is not None else None
    volatility_spike = safe_bool(pick_first(payload, ['volatilitySpike', 'volatility_spike'], False), False)

    step_mult = bps_to_mult(ladder_step_bps)
    last_order = None
    filled = None

    for step in range(ladder_steps):
        if step > 0:
            if side == 'BUY':
                limit_price = limit_price * (1.0 + step_mult)
            else:
                limit_price = limit_price * (1.0 - step_mult)

        last_order = place_limit_entry(symbol, side, quote_qty, limit_price)
        order_id = last_order.get('id')

        filled = wait_for_fill(symbol, order_id, entry_ttl_seconds)
        if filled:
            break

        cancel_order_safely(symbol, order_id)

    if not filled:
        return {'ok': False, 'reason': 'Entry not filled after ladder attempts.', 'lastOrder': last_order}

    STATE['last_trade_ts'] = time.time()
    if bar_index is not None:
        STATE['last_trade_bar_by_symbol'][symbol] = bar_index

    avg_price = float(filled.get('average') or filled.get('price') or limit_price)
    filled_amount = float(filled.get('filled') or filled.get('amount') or 0.0)

    tp_order = place_take_profit(symbol, side, filled_amount, tp_percent, avg_price)
    tp_order_price = float(tp_order.get('price') or 0.0) if isinstance(tp_order, dict) else None
    atr = atr_from_payload if atr_from_payload is not None and atr_from_payload > 0 else approx_atr_14(symbol)
    sl_order = None if volatility_spike else place_stop_loss_stop_limit(symbol, side, filled_amount, sl_atr_mult, atr, avg_price)
    sl_order_price = None
    if isinstance(sl_order, dict):
        sl_order_price = safe_float_or(sl_order.get('price') or sl_order.get('stopPrice') or 0.0, 0.0) or None

    backend_report = report_order_to_backend(
        build_backend_order_result_payload(
            payload,
            runtime=runtime or {},
            symbol=symbol,
            side=side,
            entry_order=filled,
            tp_order=tp_order if isinstance(tp_order, dict) else None,
            sl_order=sl_order if isinstance(sl_order, dict) else None,
            avg_price=avg_price,
            filled_amount=filled_amount,
            tp_price=tp_order_price,
            sl_price=sl_order_price,
        )
    )

    return {
        'ok': True,
        'symbol': symbol,
        'botInstanceId': BOT_INSTANCE_ID or runtime_bot_instance.get('id'),
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
                'note': (
                    'SL skipped due volatility_spike.'
                    if volatility_spike
                    else 'Stop-limit not supported via CCXT params; add monitor loop or native MEXC conditional order params.'
                ),
            }
        ),
        'atrApprox': atr,
        'backendReport': backend_report,
        'settings': {
            'minQuoteQty': min_quote_qty,
            'dailyLossLimitPct': daily_loss_limit_pct,
            'cooldownCandles': cooldown_candles,
            'barIndex': bar_index,
            'cooldownSeconds': cooldown_seconds,
            'entryTtlSeconds': entry_ttl_seconds,
            'ladderSteps': ladder_steps,
            'ladderStepBps': ladder_step_bps,
            'limitStyle': limit_style,
            'slippageBps': slippage_bps,
            'investmentPercentage': investment_percentage,
            'volatilitySpike': volatility_spike,
            'tpPercent': tp_percent,
            'slAtrMult': sl_atr_mult,
            'resolveExchangeFromBackend': RESOLVE_EXCHANGE_FROM_BACKEND,
            'runtimeSymbol': runtime_symbol,
            'runtimeWorkspaceId': runtime_bot_instance.get('workspaceId'),
            'runtimeBotId': runtime_bot_instance.get('botId'),
        },
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

    if 'side' not in data:
        raise HTTPException(status_code=400, detail='Missing required field: side.')

    try:
        result = execute_signal(data)
        return result
    except ccxt.BaseError as error:
        return {'ok': False, 'error': 'exchange_error', 'detail': str(error)}
    except Exception as error:
        return {'ok': False, 'error': 'bot_error', 'detail': str(error)}
