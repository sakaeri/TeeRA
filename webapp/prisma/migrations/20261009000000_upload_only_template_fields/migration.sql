-- AlterTable
ALTER TABLE "ContractTemplate" ALTER COLUMN "workplaceType" DROP NOT NULL;
ALTER TABLE "ContractTemplate" ALTER COLUMN "scheduleType" DROP NOT NULL;
ALTER TABLE "ContractTemplate" ALTER COLUMN "contractPeriodType" DROP NOT NULL;
ALTER TABLE "ContractTemplate" ADD COLUMN "isUploadOnly" BOOLEAN NOT NULL DEFAULT false;
