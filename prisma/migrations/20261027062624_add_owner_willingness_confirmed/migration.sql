-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "ownerWillingnessConfirmed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "properties_tenantId_ownerWillingnessConfirmed_idx" ON "properties"("tenantId", "ownerWillingnessConfirmed");
