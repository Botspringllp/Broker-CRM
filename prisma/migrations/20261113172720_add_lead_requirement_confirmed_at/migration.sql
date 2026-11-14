-- AlterTable
ALTER TABLE "lead_requirements" ADD COLUMN     "confirmedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "lead_requirements_tenantId_confirmedAt_idx" ON "lead_requirements"("tenantId", "confirmedAt");
