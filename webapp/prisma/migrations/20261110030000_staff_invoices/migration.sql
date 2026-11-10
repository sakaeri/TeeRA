-- 業務委託のスタッフから会社へ出す請求書
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "invoiceRegistrationNumber" TEXT;
ALTER TABLE "CompanyMembership" ADD COLUMN IF NOT EXISTS "contractorWithholding" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CompanyMembership" ADD COLUMN IF NOT EXISTS "contractorTaxExclusive" BOOLEAN NOT NULL DEFAULT false;
ALTER TYPE "TeeLedgerEntryType" ADD VALUE IF NOT EXISTS 'CONSUME_STAFF_INVOICE_OPEN';

DO $$ BEGIN
  CREATE TYPE "StaffInvoiceStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "StaffInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "targetMonth" TEXT NOT NULL,
    "status" "StaffInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "workLines" JSONB NOT NULL DEFAULT '[]',
    "expenses" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "issuerName" TEXT,
    "issuerAddress" TEXT,
    "registrationNumber" TEXT,
    "bankName" TEXT,
    "branchName" TEXT,
    "accountType" TEXT,
    "accountNumber" TEXT,
    "accountHolderName" TEXT,
    "withholding" BOOLEAN NOT NULL DEFAULT false,
    "taxExclusive" BOOLEAN NOT NULL DEFAULT false,
    "workSubtotal" INTEGER NOT NULL DEFAULT 0,
    "taxAmount" INTEGER NOT NULL DEFAULT 0,
    "withholdingAmount" INTEGER NOT NULL DEFAULT 0,
    "expensesTotal" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "openedByUserId" TEXT,
    "chargeSettledAt" TIMESTAMP(3),
    "chargedTee" BOOLEAN NOT NULL DEFAULT false,
    "countsAgainstQuota" BOOLEAN NOT NULL DEFAULT false,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "returnReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StaffInvoice_companyId_staffUserId_targetMonth_key" ON "StaffInvoice"("companyId", "staffUserId", "targetMonth");
CREATE INDEX IF NOT EXISTS "StaffInvoice_companyId_targetMonth_idx" ON "StaffInvoice"("companyId", "targetMonth");

DO $$ BEGIN
  ALTER TABLE "StaffInvoice" ADD CONSTRAINT "StaffInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "StaffInvoice" ADD CONSTRAINT "StaffInvoice_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
