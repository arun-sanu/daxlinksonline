from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from .models import NormalizedSignal
from .sizing import SizingComputation


@dataclass
class RiskGuard:
    cooldown_seconds: int
    max_open_orders_per_symbol: int
    daily_loss_cap_enabled: bool = False
    _last_trade_ts: dict[str, float] = field(default_factory=dict)

    def check(
        self,
        signal: NormalizedSignal,
        sizing: SizingComputation,
        open_orders: list[dict[str, Any]],
    ) -> list[tuple[str, str]]:
        errors: list[tuple[str, str]] = []
        symbol_key = signal.symbol.upper()
        now = time.time()

        last_ts = self._last_trade_ts.get(symbol_key)
        if last_ts and self.cooldown_seconds > 0 and (now - last_ts) < self.cooldown_seconds:
            errors.append(("cooldown_active", f"Cooldown active for {symbol_key}"))

        if self.max_open_orders_per_symbol > 0 and len(open_orders) >= self.max_open_orders_per_symbol:
            errors.append(
                (
                    "too_many_open_orders",
                    f"Open order count {len(open_orders)} reached max {self.max_open_orders_per_symbol}",
                )
            )

        if signal.side == "buy" and sizing.quote_spend > sizing.free_quote:
            errors.append(("insufficient_quote_balance", "Quote balance is insufficient for computed quoteSpend"))

        if signal.side == "sell" and sizing.qty_final > sizing.free_base:
            errors.append(("insufficient_base_balance", "Base balance is insufficient for computed qty"))

        # Hook only. Integrate realized/unrealized PnL ledger when available.
        if self.daily_loss_cap_enabled:
            cap_error = self._daily_loss_cap_hook(signal)
            if cap_error:
                errors.append(cap_error)

        return errors

    def mark_trade(self, symbol: str) -> None:
        self._last_trade_ts[symbol.upper()] = time.time()

    def _daily_loss_cap_hook(self, _signal: NormalizedSignal) -> tuple[str, str] | None:
        return None
