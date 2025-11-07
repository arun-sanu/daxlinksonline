-- Add responseBody column to WebhookDelivery for storing response text (truncated client-side)
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "responseBody" TEXT;
