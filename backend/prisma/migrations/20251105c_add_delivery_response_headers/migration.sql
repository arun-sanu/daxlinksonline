-- Add responseHeaders column to WebhookDelivery for capturing response headers as JSON
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "responseHeaders" JSONB;
