from app.models import NormalizedSignal
from app.sizing import SizingError, compute_sizing


def make_signal(**overrides):
    payload = {
        "id": "signal-test",
        "symbol": "BTC/USDC",
        "side": "buy",
        "order": {"type": "market", "limit_price": None},
        "risk": {
            "mode": "balance_pct",
            "value": 1.0,
            "min_quote_spend": 1.05,
            "max_quote_spend": 50.0,
        },
        "sl": {"type": "percent", "value": 2.0},
        "tp": {"type": "rr", "value": 3.0},
        "meta": {"strategy": "ARN", "timeframe": "5m", "source": "tradingview"},
        "timestamp": 1739459200,
        "signal_price": None,
    }
    payload.update(overrides)
    return NormalizedSignal.model_validate(payload)


def test_balance_pct_sizing_with_clamp():
    signal = make_signal()
    balance = {"USDC": {"free": 1000.0}, "BTC": {"free": 0.01}}
    market = {
        "precision": {"amount": 6},
        "limits": {"cost": {"min": 1.0}},
        "info": {},
    }
    comp = compute_sizing(signal, balance, market, ticker_last=20000.0)
    assert float(comp.quote_spend) == 10.0
    assert float(comp.qty_raw) == 0.0005
    assert float(comp.qty_final) == 0.0005
    assert float(comp.effective_min_notional) == 1.05


def test_fixed_quote_rounds_down_to_step():
    signal = make_signal(
        risk={"mode": "fixed_quote", "value": 10.0, "min_quote_spend": 1.0, "max_quote_spend": 10.0}
    )
    balance = {"USDC": {"free": 200.0}, "BTC": {"free": 0.02}}
    market = {
        "precision": {"amount": 8},
        "limits": {"cost": {"min": 1.0}},
        "info": {"stepSize": "0.0001"},
    }
    comp = compute_sizing(signal, balance, market, ticker_last=30000.0)
    assert round(float(comp.qty_raw), 8) == 0.00033333
    assert float(comp.qty_final) == 0.0003


def test_rejects_when_qty_becomes_zero():
    signal = make_signal(
        risk={"mode": "fixed_quote", "value": 2.0, "min_quote_spend": 1.0, "max_quote_spend": 2.0}
    )
    balance = {"USDC": {"free": 10.0}, "BTC": {"free": 0.0}}
    market = {
        "precision": {"amount": 0},
        "limits": {"cost": {"min": 1.0}},
        "info": {"stepSize": "1"},
    }
    try:
        compute_sizing(signal, balance, market, ticker_last=10000.0)
        assert False, "Expected SizingError"
    except SizingError as exc:
        assert exc.reason == "qty_zero_after_rounding"


def test_rejects_below_min_notional():
    signal = make_signal(
        risk={"mode": "fixed_quote", "value": 1.2, "min_quote_spend": 1.0, "max_quote_spend": 1.2}
    )
    balance = {"USDC": {"free": 20.0}, "BTC": {"free": 0.0}}
    market = {
        "precision": {"amount": 6},
        "limits": {"cost": {"min": 5.0}},
        "info": {"stepSize": "0.0001"},
    }
    try:
        compute_sizing(signal, balance, market, ticker_last=1000.0)
        assert False, "Expected SizingError"
    except SizingError as exc:
        assert exc.reason == "below_min_notional"
