-- CreateTable
CREATE TABLE "TradeTransaction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "botId" TEXT,
    "botInstanceId" TEXT,
    "orderId" TEXT,
    "executionAuditId" TEXT,
    "forwardedSignalId" TEXT,
    "integrationId" TEXT,
    "exchangeAccountId" TEXT,
    "venue" TEXT,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "orderType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'executed',
    "amount" DECIMAL(38,12),
    "quantity" DECIMAL(38,12),
    "value" DECIMAL(38,12),
    "marketPrice" DECIMAL(38,12),
    "executionPrice" DECIMAL(38,12),
    "feeAmount" DECIMAL(38,12),
    "feeAsset" TEXT,
    "realizedPnl" DECIMAL(38,12),
    "unrealizedPnl" DECIMAL(38,12),
    "accountBalanceBefore" DECIMAL(38,12),
    "accountBalanceAfter" DECIMAL(38,12),
    "accountEquityBefore" DECIMAL(38,12),
    "accountEquityAfter" DECIMAL(38,12),
    "balanceAsset" TEXT,
    "positionQtyBefore" DECIMAL(38,12),
    "positionQtyAfter" DECIMAL(38,12),
    "decisionContext" JSONB,
    "sizingContext" JSONB,
    "exchangePayload" JSONB,
    "metadata" JSONB,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeTransaction_workspaceId_executedAt_idx" ON "TradeTransaction"("workspaceId", "executedAt");

-- CreateIndex
CREATE INDEX "TradeTransaction_botId_executedAt_idx" ON "TradeTransaction"("botId", "executedAt");

-- CreateIndex
CREATE INDEX "TradeTransaction_botInstanceId_executedAt_idx" ON "TradeTransaction"("botInstanceId", "executedAt");

-- CreateIndex
CREATE INDEX "TradeTransaction_integrationId_executedAt_idx" ON "TradeTransaction"("integrationId", "executedAt");

-- CreateIndex
CREATE INDEX "TradeTransaction_orderId_idx" ON "TradeTransaction"("orderId");

-- CreateIndex
CREATE INDEX "TradeTransaction_executionAuditId_idx" ON "TradeTransaction"("executionAuditId");

-- CreateIndex
CREATE INDEX "TradeTransaction_forwardedSignalId_idx" ON "TradeTransaction"("forwardedSignalId");

-- CreateIndex
CREATE INDEX "TradeTransaction_symbol_executedAt_idx" ON "TradeTransaction"("symbol", "executedAt");

-- CreateIndex
CREATE INDEX "TradeTransaction_status_executedAt_idx" ON "TradeTransaction"("status", "executedAt");
