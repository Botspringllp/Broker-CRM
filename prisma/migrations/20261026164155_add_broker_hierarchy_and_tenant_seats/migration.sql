-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "maxSeats" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "user_audit_logs" ALTER COLUMN "targetUserId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "brokerId" TEXT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
