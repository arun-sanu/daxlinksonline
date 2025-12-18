-- Add enforceHmac flag and backfill missing HMAC keys
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "enforceHmac" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User"
SET "webhookHmacKey" = md5(random()::text || clock_timestamp()::text) || md5(clock_timestamp()::text || random()::text)
WHERE "webhookHmacKey" IS NULL;
