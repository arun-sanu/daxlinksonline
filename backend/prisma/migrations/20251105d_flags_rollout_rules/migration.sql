-- Add rollout and rules to FeatureFlag
ALTER TABLE "FeatureFlag" ADD COLUMN IF NOT EXISTS "rolloutPercent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FeatureFlag" ADD COLUMN IF NOT EXISTS "rules" JSONB;
