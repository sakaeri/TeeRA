-- AlterTable
ALTER TABLE "Company" ADD COLUMN "requireIdDocument" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "requireBankInfo" BOOLEAN NOT NULL DEFAULT true;
