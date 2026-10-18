-- CreateEnum
CREATE TYPE "CancelPolicy" AS ENUM ('FREE', 'FEE_AFTER_DEADLINE', 'DENY_AFTER_DEADLINE', 'NOT_ALLOWED');

-- AlterTable
ALTER TABLE "CompanyPlacementRate" ADD COLUMN     "cancelDeadlineDaysBefore" INTEGER,
ADD COLUMN     "cancelDeadlineTime" TEXT,
ADD COLUMN     "cancelFeeAmount" INTEGER,
ADD COLUMN     "cancelPolicy" "CancelPolicy" NOT NULL DEFAULT 'FREE';

-- CreateTable
CREATE TABLE "ShiftCancellation" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "cancelledByCompanyId" TEXT NOT NULL,
    "cancelledByUserId" TEXT,
    "feeAmount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShiftCancellation_shiftId_key" ON "ShiftCancellation"("shiftId");

-- AddForeignKey
ALTER TABLE "ShiftCancellation" ADD CONSTRAINT "ShiftCancellation_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

