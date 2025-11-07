-- CreateTable
CREATE TABLE "DatabaseInstance" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "engine" TEXT NOT NULL DEFAULT 'postgres',
    "version" TEXT NOT NULL DEFAULT '16',
    "region" TEXT NOT NULL DEFAULT 'us-east',
    "sizeTier" TEXT NOT NULL,
    "storageGb" INTEGER NOT NULL DEFAULT 10,
    "computeClass" TEXT NOT NULL DEFAULT 'standard',
    "status" TEXT NOT NULL DEFAULT 'provisioning',
    "host" TEXT,
    "port" INTEGER DEFAULT 5432,
    "database" TEXT,
    "username" TEXT,
    "passwordMasked" TEXT,
    "sslRequired" BOOLEAN NOT NULL DEFAULT true,
    "providerId" TEXT,
    "workspaceId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatabaseInstance_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DatabaseInstance" ADD CONSTRAINT "DatabaseInstance_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
