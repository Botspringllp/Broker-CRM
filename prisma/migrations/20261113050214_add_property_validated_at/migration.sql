-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "validatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "properties_tenantId_validatedAt_idx" ON "properties"("tenantId", "validatedAt");
