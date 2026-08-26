/*
  Warnings:

  - You are about to drop the column `companyPlacementRateId` on the `Shift` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Shift" DROP CONSTRAINT "Shift_companyPlacementRateId_fkey";

-- AlterTable
ALTER TABLE "CompanyPlacementRate" ALTER COLUMN "wageType" DROP NOT NULL,
ALTER COLUMN "amount" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN "taskName" TEXT;

-- Backfill: carry over the task name from whatever specific rate row a shift
-- had linked before the rate itself is decoupled from the shift.
UPDATE "Shift" s
SET "taskName" = r."taskName"
FROM "CompanyPlacementRate" r
WHERE s."companyPlacementRateId" = r."id";

ALTER TABLE "Shift" DROP COLUMN "companyPlacementRateId";

-- CreateTable
CREATE TABLE "StaffTaskRate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "taskName" TEXT NOT NULL,
    "wageType" "WageType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffTaskRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffTaskRate_companyId_idx" ON "StaffTaskRate"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffTaskRate_companyId_staffUserId_taskName_key" ON "StaffTaskRate"("companyId", "staffUserId", "taskName");

-- AddForeignKey
ALTER TABLE "StaffTaskRate" ADD CONSTRAINT "StaffTaskRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTaskRate" ADD CONSTRAINT "StaffTaskRate_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
