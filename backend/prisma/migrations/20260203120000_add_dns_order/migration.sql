-- Add per-user DNS ordering preferences
ALTER TABLE "User" ADD COLUMN "dnsOrder" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
