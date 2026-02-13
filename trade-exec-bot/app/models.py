from typing import Any, Literal

from pydantic import BaseModel, Field


OrderType = Literal["market", "limit"]
SideType = Literal["buy", "sell"]
RiskMode = Literal["balance_pct", "fixed_quote"]
StopMode = Literal["percent", "rr", "absolute", "none"]


class OrderSpec(BaseModel):
    type: OrderType = "market"
    limit_price: float | None = None


class RiskSpec(BaseModel):
    mode: RiskMode = "balance_pct"
    value: float = 1.0
    min_quote_spend: float = 1.05
    max_quote_spend: float = 50.0


class StopSpec(BaseModel):
    type: StopMode = "none"
    value: float | None = None


class SignalMeta(BaseModel):
    strategy: str | None = None
    timeframe: str | None = None
    source: str | None = None
    workspaceId: str | None = None
    botId: str | None = None
    botInstanceId: str | None = None


class NormalizedSignal(BaseModel):
    id: str
    symbol: str
    side: SideType
    order: OrderSpec = Field(default_factory=OrderSpec)
    risk: RiskSpec = Field(default_factory=RiskSpec)
    sl: StopSpec = Field(default_factory=StopSpec)
    tp: StopSpec = Field(default_factory=StopSpec)
    meta: SignalMeta = Field(default_factory=SignalMeta)
    timestamp: int
    signal_price: float | None = None


class SizingResult(BaseModel):
    mode: str
    freeQuote: float
    freeBase: float
    quoteSpend: float
    qtyRaw: float
    qtyFinal: float
    refPrice: float
    exchangeMinNotional: float
    effectiveMinNotional: float
    precisionAmount: int | None = None
    stepSize: float | None = None
    roundingMethod: str = "floor"
    status: str = "ready"
    rejectReason: str | None = None


class ProtectionResult(BaseModel):
    tp: dict[str, Any] | None = None
    sl: dict[str, Any] | None = None
    errors: list[str] = Field(default_factory=list)


class ExecutionResponse(BaseModel):
    ok: bool
    signalId: str
    entryOrder: dict[str, Any]
    protection: ProtectionResult
    sizing: dict[str, Any]
    errors: list[str] = Field(default_factory=list)
