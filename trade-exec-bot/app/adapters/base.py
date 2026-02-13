from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class ExchangeAdapter(ABC):
    @abstractmethod
    def load_market(self, symbol: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def fetch_balance(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def fetch_ticker(self, symbol: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def fetch_open_orders(self, symbol: str) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def create_entry_order(
        self,
        symbol: str,
        side: str,
        order_type: str,
        qty: float,
        price: float | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def create_protection_orders(
        self,
        symbol: str,
        side: str,
        qty: float,
        sl_price: float | None,
        tp_price: float | None,
    ) -> dict[str, Any]:
        raise NotImplementedError
