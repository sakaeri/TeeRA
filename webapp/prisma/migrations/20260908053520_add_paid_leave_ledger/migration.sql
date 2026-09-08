-- CreateEnum
CREATE TYPE "PaidLeaveEventType" AS ENUM ('GRANT', 'USE', 'ADJUST');

-- AlterTable
ALTER TABLE "CompanyMembership" ADD COLUMN     "hireDate" DATE,
ADD COLUMN     "nextPaidLeaveGrantDate" DATE,
ADD COLUMN     "paidLeaveBalance" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PaidLeaveEvent" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "type" "PaidLeaveEventType" NOT NULL,
    "days" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaidLeaveEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaidLeaveEvent_membershipId_createdAt_idx" ON "PaidLeaveEvent"("membershipId", "createdAt");

-- AddForeignKey
ALTER TABLE "PaidLeaveEvent" ADD CONSTRAINT "PaidLeaveEvent_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "CompanyMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidLeaveEvent" ADD CONSTRAINT "PaidLeaveEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
