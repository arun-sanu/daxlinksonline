-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "minNotional" DECIMAL(38,12),
ADD COLUMN     "qtyFinal" DECIMAL(38,12),
ADD COLUMN     "qtyRaw" DECIMAL(38,12),
ADD COLUMN     "quoteSpend" DECIMAL(38,12),
ADD COLUMN     "refPrice" DECIMAL(38,12),
ADD COLUMN     "riskMode" TEXT,
ADD COLUMN     "riskValue" DECIMAL(38,12),
ADD COLUMN     "sizingRejectReason" TEXT,
ADD COLUMN     "sizingStatus" TEXT,
ADD COLUMN     "slPrice" DECIMAL(38,12),
ADD COLUMN     "stepSize" DECIMAL(38,12),
ADD COLUMN     "tpPrice" DECIMAL(38,12);

-- CreateTable
CREATE TABLE "OrderSizingReport" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "freeQuote" DECIMAL(38,12),
    "freeBase" DECIMAL(38,12),
    "exchangeMinNotional" DECIMAL(38,12),
    "effectiveMinNotional" DECIMAL(38,12),
    "precisionAmount" DECIMAL(38,12),
    "stepSize" DECIMAL(38,12),
    "roundingMethod" TEXT,
    "rawPayload" JSONB NOT NULL,
    "normalizedSignal" JSONB NOT NULL,
    "executionResult" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderSizingReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderSizingReport_orderId_key" ON "OrderSizingReport"("orderId");

-- CreateIndex
CREATE INDEX "OrderSizingReport_createdAt_idx" ON "OrderSizingReport"("createdAt");

-- AddForeignKey
ALTER TABLE "OrderSizingReport" ADD CONSTRAINT "OrderSizingReport_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
