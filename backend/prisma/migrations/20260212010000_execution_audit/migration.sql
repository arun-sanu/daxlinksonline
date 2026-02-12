-- CreateTable
CREATE TABLE "ExecutionAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "botId" TEXT,
    "integrationId" TEXT,
    "tradingviewAlertId" TEXT,
    "forwardedSignalId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tvTs" BIGINT,
    "dedupeKey" TEXT,
    "symbol" TEXT,
    "side" TEXT,
    "strategyName" TEXT,
    "rawBody" TEXT,
    "parsedPayload" JSONB,
    "computedPrice" DOUBLE PRECISION,
    "freeQuote" DOUBLE PRECISION,
    "qtyRaw" DOUBLE PRECISION,
    "qtyRounded" DOUBLE PRECISION,
    "mexcOrderId" TEXT,
    "mexcStatus" TEXT,
    "mexcRawResponse" JSONB,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExecutionAudit_userId_receivedAt_idx" ON "ExecutionAudit"("userId", "receivedAt");

-- CreateIndex
CREATE INDEX "ExecutionAudit_botId_dedupeKey_idx" ON "ExecutionAudit"("botId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ExecutionAudit_dedupeKey_receivedAt_idx" ON "ExecutionAudit"("dedupeKey", "receivedAt");

-- CreateIndex
CREATE INDEX "ExecutionAudit_status_receivedAt_idx" ON "ExecutionAudit"("status", "receivedAt");

-- AddForeignKey
ALTER TABLE "ExecutionAudit" ADD CONSTRAINT "ExecutionAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
