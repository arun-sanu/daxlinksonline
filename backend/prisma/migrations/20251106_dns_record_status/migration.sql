-- Ensure DnsRecord table exists for environments created prior to this migration
CREATE TABLE IF NOT EXISTS "DnsRecord" (
  "id" TEXT NOT NULL,
  "subdomain" TEXT NOT NULL,
  "cloudflareId" TEXT NOT NULL,
  "ip" TEXT,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DnsRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DnsRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "DnsRecord_subdomain_idx" ON "DnsRecord"("subdomain");
CREATE INDEX IF NOT EXISTS "DnsRecord_userId_idx" ON "DnsRecord"("userId");

-- Add status + createdAt columns to DnsRecord for custom DNS tracking
ALTER TABLE "DnsRecord"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
