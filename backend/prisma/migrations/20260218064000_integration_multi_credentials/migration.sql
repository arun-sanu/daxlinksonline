-- Allow multiple credentials per integration
DROP INDEX IF EXISTS "IntegrationCredential_integrationId_key";

-- Keep lookup performance for integration -> credentials queries
CREATE INDEX IF NOT EXISTS "IntegrationCredential_integrationId_idx" ON "IntegrationCredential"("integrationId");
