-- Add responseTimeMs to WebhookDelivery
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "responseTimeMs" INTEGER;
