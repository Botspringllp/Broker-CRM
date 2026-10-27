-- AlterTable
ALTER TABLE "property_media" ADD COLUMN     "uploadedById" TEXT;

-- CreateIndex
CREATE INDEX "property_media_tenantId_uploadedById_idx" ON "property_media"("tenantId", "uploadedById");

-- AddForeignKey
ALTER TABLE "property_media" ADD CONSTRAINT "property_media_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
