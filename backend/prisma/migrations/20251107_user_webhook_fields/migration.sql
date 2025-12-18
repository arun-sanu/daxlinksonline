-- Add columns to support wildcard webhook prefixes and HMAC security
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "subdomainPrefix" TEXT,
  ADD COLUMN IF NOT EXISTS "webhookHmacKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_subdomainPrefix_key" ON "User"("subdomainPrefix");
