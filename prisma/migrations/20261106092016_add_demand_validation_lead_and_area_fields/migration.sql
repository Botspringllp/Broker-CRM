-- AlterTable
ALTER TABLE "lead_requirements" ADD COLUMN     "areaUnit" TEXT NOT NULL DEFAULT 'sq.ft',
ADD COLUMN     "maxArea" DECIMAL(12,2),
ADD COLUMN     "minArea" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "isDoNotContact" BOOLEAN NOT NULL DEFAULT false;
