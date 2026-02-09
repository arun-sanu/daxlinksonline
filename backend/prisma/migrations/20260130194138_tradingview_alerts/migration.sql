/*
  Warnings:

  - The `passphrase` column on the `IntegrationCredential` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[shortCode]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[webhookSubdomain]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[shortCode]` on the table `Workspace` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `iv` to the `IntegrationCredential` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `apiKey` on the `IntegrationCredential` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `apiSecret` on the `IntegrationCredential` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "NotifyChannel" AS ENUM ('TELEGRAM', 'ANDROID', 'EMAIL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "DigestMode" AS ENUM ('INSTANT', 'HOURLY', 'DAILY');

-- DropForeignKey
ALTER TABLE "DnsRecord" DROP CONSTRAINT "DnsRecord_userId_fkey";

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN     "description" TEXT,
ADD COLUMN     "label" TEXT;

-- AlterTable
ALTER TABLE "IntegrationCredential" ADD COLUMN     "iv" BYTEA NOT NULL,
DROP COLUMN "apiKey",
ADD COLUMN     "apiKey" BYTEA NOT NULL,
DROP COLUMN "apiSecret",
ADD COLUMN     "apiSecret" BYTEA NOT NULL,
DROP COLUMN "passphrase",
ADD COLUMN     "passphrase" BYTEA;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "shortCode" TEXT,
ADD COLUMN     "trialEndsAt" TIMESTAMP(3),
ADD COLUMN     "webhookSecret" TEXT,
ADD COLUMN     "webhookSubdomain" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "shortCode" TEXT,
ADD COLUMN     "workflowConfig" JSONB;

-- CreateTable
CREATE TABLE "Secret" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "key" TEXT NOT NULL,
    "valueMasked" TEXT NOT NULL,
    "valueBlob" BYTEA,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Secret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'low',
    "status" TEXT NOT NULL DEFAULT 'open',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentNote" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "platform" TEXT NOT NULL,
    "fcmToken" TEXT NOT NULL,
    "appVersion" TEXT,
    "sdkInt" INTEGER,
    "model" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushTokenHistory" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "fcmToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidatedAt" TIMESTAMP(3),

    CONSTRAINT "PushTokenHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tvSignals" BOOLEAN NOT NULL DEFAULT true,
    "botTrades" BOOLEAN NOT NULL DEFAULT true,
    "exchangeFills" BOOLEAN NOT NULL DEFAULT true,
    "errors" BOOLEAN NOT NULL DEFAULT true,
    "subscriptions" BOOLEAN NOT NULL DEFAULT true,
    "promotions" BOOLEAN NOT NULL DEFAULT false,
    "digestMode" "DigestMode" NOT NULL DEFAULT 'INSTANT',
    "preferred" "NotifyChannel",
    "quietStart" TEXT,
    "quietEnd" TEXT,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "channel" "NotifyChannel" NOT NULL,
    "bodyMarkdown" TEXT,
    "bodyText" TEXT,
    "vars" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "channelPlanned" "NotifyChannel",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "channel" "NotifyChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "providerMessageId" TEXT,
    "errorText" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForwardedSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "integrationId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "symbol" TEXT,
    "side" TEXT,
    "type" TEXT,
    "amount" DOUBLE PRECISION,
    "price" DOUBLE PRECISION,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForwardedSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingviewAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'tradingview',
    "strategyName" TEXT,
    "symbol" TEXT,
    "side" TEXT,
    "orderType" TEXT,
    "quantity" DOUBLE PRECISION,
    "takeProfit" DOUBLE PRECISION,
    "stopLoss" DOUBLE PRECISION,
    "webhookSubdomain" TEXT,
    "clientIp" TEXT,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'received',
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingviewAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "apiSecretEnc" TEXT NOT NULL,
    "passphraseEnc" TEXT,
    "isSandbox" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cpuMilli" INTEGER NOT NULL,
    "memMiB" INTEGER NOT NULL,
    "priceMonthly" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rental" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "renterWorkspaceId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "exchangeAccountId" TEXT NOT NULL,
    "botInstanceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "revenueShareBps" INTEGER NOT NULL DEFAULT 7000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT,
    "latestVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotVersion" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "imageRef" TEXT,
    "signedDigest" TEXT,
    "sbomRef" TEXT,
    "sdkVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotInstance" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "botVersionId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "exchangeAccountId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "leverage" INTEGER NOT NULL DEFAULT 1,
    "maxDailyLossPct" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "takeProfitPct" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "slAtrMult" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "useLimitEntries" BOOLEAN NOT NULL DEFAULT true,
    "minNotional" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "status" TEXT NOT NULL DEFAULT 'stopped',
    "webhookToken" TEXT NOT NULL,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardrailEvent" (
    "id" TEXT NOT NULL,
    "botInstanceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardrailEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotRun" (
    "id" TEXT NOT NULL,
    "botInstanceId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "metricsJson" JSONB,
    "logsJson" JSONB,

    CONSTRAINT "BotRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "botInstanceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "botInstanceId" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "price" DECIMAL(38,12),
    "qty" DECIMAL(38,12) NOT NULL,
    "status" TEXT NOT NULL,
    "venueOrderId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "botInstanceId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "entryPrice" DECIMAL(38,12) NOT NULL,
    "qty" DECIMAL(38,12) NOT NULL,
    "pnl" DECIMAL(38,12) NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Secret_workspaceId_idx" ON "Secret"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Secret_workspaceId_key_key" ON "Secret"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "IncidentNote_incidentId_idx" ON "IncidentNote"("incidentId");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_userId_fcmToken_key" ON "Device"("userId", "fcmToken");

-- CreateIndex
CREATE INDEX "PushTokenHistory_deviceId_idx" ON "PushTokenHistory"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE INDEX "NotificationTemplate_key_channel_idx" ON "NotificationTemplate"("key", "channel");

-- CreateIndex
CREATE INDEX "NotificationEvent_userId_idx" ON "NotificationEvent"("userId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_eventId_channel_idx" ON "NotificationDelivery"("eventId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "ForwardedSignal_idempotencyKey_key" ON "ForwardedSignal"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ForwardedSignal_userId_createdAt_idx" ON "ForwardedSignal"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TradingviewAlert_userId_receivedAt_idx" ON "TradingviewAlert"("userId", "receivedAt");

-- CreateIndex
CREATE INDEX "ExchangeAccount_workspaceId_venue_idx" ON "ExchangeAccount"("workspaceId", "venue");

-- CreateIndex
CREATE UNIQUE INDEX "Rental_botInstanceId_key" ON "Rental"("botInstanceId");

-- CreateIndex
CREATE INDEX "GuardrailEvent_botInstanceId_createdAt_idx" ON "GuardrailEvent"("botInstanceId", "createdAt");

-- CreateIndex
CREATE INDEX "GuardrailEvent_type_createdAt_idx" ON "GuardrailEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "BotRun_botInstanceId_status_idx" ON "BotRun"("botInstanceId", "status");

-- CreateIndex
CREATE INDEX "Signal_botInstanceId_processed_idx" ON "Signal"("botInstanceId", "processed");

-- CreateIndex
CREATE UNIQUE INDEX "Signal_botInstanceId_externalId_key" ON "Signal"("botInstanceId", "externalId");

-- CreateIndex
CREATE INDEX "Order_botInstanceId_symbol_status_idx" ON "Order"("botInstanceId", "symbol", "status");

-- CreateIndex
CREATE INDEX "Position_botInstanceId_symbol_closedAt_idx" ON "Position"("botInstanceId", "symbol", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_shortCode_key" ON "User"("shortCode");

-- CreateIndex
CREATE UNIQUE INDEX "User_webhookSubdomain_key" ON "User"("webhookSubdomain");

-- CreateIndex
CREATE INDEX "User_trialEndsAt_idx" ON "User"("trialEndsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_shortCode_key" ON "Workspace"("shortCode");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushTokenHistory" ADD CONSTRAINT "PushTokenHistory_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NotificationEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingviewAlert" ADD CONSTRAINT "TradingviewAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DnsRecord" ADD CONSTRAINT "DnsRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeAccount" ADD CONSTRAINT "ExchangeAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_renterWorkspaceId_fkey" FOREIGN KEY ("renterWorkspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_exchangeAccountId_fkey" FOREIGN KEY ("exchangeAccountId") REFERENCES "ExchangeAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_botInstanceId_fkey" FOREIGN KEY ("botInstanceId") REFERENCES "BotInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotVersion" ADD CONSTRAINT "BotVersion_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotInstance" ADD CONSTRAINT "BotInstance_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotInstance" ADD CONSTRAINT "BotInstance_botVersionId_fkey" FOREIGN KEY ("botVersionId") REFERENCES "BotVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotInstance" ADD CONSTRAINT "BotInstance_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotInstance" ADD CONSTRAINT "BotInstance_exchangeAccountId_fkey" FOREIGN KEY ("exchangeAccountId") REFERENCES "ExchangeAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardrailEvent" ADD CONSTRAINT "GuardrailEvent_botInstanceId_fkey" FOREIGN KEY ("botInstanceId") REFERENCES "BotInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotRun" ADD CONSTRAINT "BotRun_botInstanceId_fkey" FOREIGN KEY ("botInstanceId") REFERENCES "BotInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_botInstanceId_fkey" FOREIGN KEY ("botInstanceId") REFERENCES "BotInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_botInstanceId_fkey" FOREIGN KEY ("botInstanceId") REFERENCES "BotInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_botInstanceId_fkey" FOREIGN KEY ("botInstanceId") REFERENCES "BotInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
