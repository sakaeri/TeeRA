-- AlterTable
ALTER TABLE "StaffPlacement" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "endedAt" TIMESTAMP(3);
