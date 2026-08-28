-- AlterEnum
ALTER TYPE "ApprovalStatus" ADD VALUE 'NEEDS_CONFIRMATION';

-- AlterTable
ALTER TABLE "WorkReport" ADD COLUMN     "correctedAt" TIMESTAMP(3),
ADD COLUMN     "correctedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "WorkReport" ADD CONSTRAINT "WorkReport_correctedByUserId_fkey" FOREIGN KEY ("correctedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
