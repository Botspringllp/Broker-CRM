-- CreateEnum
CREATE TYPE "PortalProvider" AS ENUM ('99ACRES', 'MAGICBRICKS', 'NOBROKER');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateTable
CREATE TABLE "tenant_portal_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "PortalProvider" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "webhookTokenHash" TEXT NOT NULL,
    "tokenCreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokenRotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_portal_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_webhook_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "PortalProvider" NOT NULL,
    "externalEventId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "WebhookProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "eventAction" TEXT,
    "leadPhone" TEXT,
    "leadEmail" TEXT,
    "advertisedPropertyRef" TEXT,
    "rawPayload" JSONB,
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_portal_configs_webhookTokenHash_idx" ON "tenant_portal_configs"("webhookTokenHash");

-- CreateIndex
CREATE INDEX "tenant_portal_configs_tenantId_isEnabled_idx" ON "tenant_portal_configs"("tenantId", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_portal_configs_tenantId_provider_key" ON "tenant_portal_configs"("tenantId", "provider");

-- CreateIndex
CREATE INDEX "portal_webhook_events_tenantId_status_receivedAt_idx" ON "portal_webhook_events"("tenantId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "portal_webhook_events_tenantId_provider_externalEventId_idx" ON "portal_webhook_events"("tenantId", "provider", "externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_webhook_events_tenantId_provider_idempotencyKey_key" ON "portal_webhook_events"("tenantId", "provider", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "tenant_portal_configs" ADD CONSTRAINT "tenant_portal_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_webhook_events" ADD CONSTRAINT "portal_webhook_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
