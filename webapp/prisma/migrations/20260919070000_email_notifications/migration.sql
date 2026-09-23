-- AlterTable
ALTER TABLE "Company" ADD COLUMN "notificationEmail" TEXT;

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN "reminderSentAt" TIMESTAMP(3);

-- AlterEnum
ALTER TYPE "AccountActionTokenKind" ADD VALUE 'APPROVE_WORK_REPORT';

-- AlterTable
ALTER TABLE "AccountActionToken" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "AccountActionToken" ADD COLUMN "workReportId" TEXT;

-- CreateIndex
CREATE INDEX "AccountActionToken_workReportId_idx" ON "AccountActionToken"("workReportId");

-- AddForeignKey
ALTER TABLE "AccountActionToken" ADD CONSTRAINT "AccountActionToken_workReportId_fkey" FOREIGN KEY ("workReportId") REFERENCES "WorkReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
