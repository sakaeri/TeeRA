-- AlterTable
ALTER TABLE "ContractTemplate" ADD COLUMN "requireIdDocument" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "requireBankInfo" BOOLEAN NOT NULL DEFAULT true;
