-- CreateEnum
CREATE TYPE "PropertyVerificationStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'REJECTED', 'UNABLE_TO_VERIFY');

-- CreateEnum
CREATE TYPE "UnableToVerifyReason" AS ENUM ('DOOR_LOCKED', 'OWNER_KEYHOLDER_UNRESPONSIVE', 'TENANT_REFUSED_ENTRY', 'SECURITY_DENIED_ACCESS', 'WRONG_ADDRESS_OR_LOCATION', 'OTHER');

-- CreateEnum
CREATE TYPE "PropertyCondition" AS ENUM ('EXCELLENT', 'GOOD', 'AVERAGE', 'POOR');

-- CreateEnum
CREATE TYPE "VerificationOccupancyState" AS ENUM ('VACANT', 'SELF_OCCUPIED', 'TENANT_OCCUPIED', 'OTHER');

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "fieldVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "isFieldVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "property_media" ADD COLUMN     "verificationId" TEXT;

-- CreateTable
CREATE TABLE "property_verifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "verifierId" TEXT NOT NULL,
    "assignedByUserId" TEXT,
    "status" "PropertyVerificationStatus" NOT NULL DEFAULT 'ASSIGNED',
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewNotes" TEXT,
    "physicalMatch" BOOLEAN,
    "occupancyState" "VerificationOccupancyState",
    "actualBedrooms" INTEGER,
    "actualBathrooms" INTEGER,
    "propertyCondition" "PropertyCondition",
    "amenitiesConfirmed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keyHolderConfirmed" BOOLEAN,
    "checklistResults" JSONB,
    "discrepancies" TEXT,
    "verifierRemarks" TEXT,
    "unableToVerifyReason" "UnableToVerifyReason",
    "unableToVerifyNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "property_verifications_tenantId_verifierId_status_idx" ON "property_verifications"("tenantId", "verifierId", "status");

-- CreateIndex
CREATE INDEX "property_verifications_tenantId_propertyId_status_idx" ON "property_verifications"("tenantId", "propertyId", "status");

-- CreateIndex
CREATE INDEX "property_verifications_tenantId_status_idx" ON "property_verifications"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "property_verifications_id_tenantId_key" ON "property_verifications"("id", "tenantId");

-- CreateIndex
CREATE INDEX "properties_tenantId_isFieldVerified_idx" ON "properties"("tenantId", "isFieldVerified");

-- CreateIndex
CREATE INDEX "property_media_tenantId_verificationId_idx" ON "property_media"("tenantId", "verificationId");

-- AddForeignKey
ALTER TABLE "property_media" ADD CONSTRAINT "property_media_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "property_verifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_verifications" ADD CONSTRAINT "property_verifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_verifications" ADD CONSTRAINT "property_verifications_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_verifications" ADD CONSTRAINT "property_verifications_verifierId_fkey" FOREIGN KEY ("verifierId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_verifications" ADD CONSTRAINT "property_verifications_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_verifications" ADD CONSTRAINT "property_verifications_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
