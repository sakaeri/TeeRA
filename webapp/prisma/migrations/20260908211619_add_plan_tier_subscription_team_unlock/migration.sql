-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'STANDARD', 'BUSINESS');

-- CreateEnum
CREATE TYPE "StripeSubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- AlterEnum
ALTER TYPE "TeeLedgerEntryType" ADD VALUE 'CONSUME_TEAM_UNLOCK';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "planTier" "PlanTier" NOT NULL DEFAULT 'FREE';

-- AlterTable
ALTER TABLE "InvoiceIssue" ADD COLUMN     "countsAgainstQuota" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SalarySlipIssue" ADD COLUMN     "countsAgainstQuota" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TeeLedgerEntry" ADD COLUMN     "teamId" TEXT;

-- CreateTable
CREATE TABLE "StripeSubscription" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stripeCheckoutSessionId" TEXT,
    "stripeSubscriptionId" TEXT,
    "planTier" "PlanTier" NOT NULL,
    "status" "StripeSubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StripeSubscription_stripeCheckoutSessionId_key" ON "StripeSubscription"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeSubscription_stripeSubscriptionId_key" ON "StripeSubscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "StripeSubscription_companyId_createdAt_idx" ON "StripeSubscription"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "TeeLedgerEntry" ADD CONSTRAINT "TeeLedgerEntry_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripeSubscription" ADD CONSTRAINT "StripeSubscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RowLevelSecurity (see 20260908194000_enable_row_level_security — Supabase auto-exposes all
-- public-schema tables via PostgREST unless RLS is enabled; Prisma connects as the table-owner
-- role and bypasses RLS, so this has no functional effect on the app)
ALTER TABLE "StripeSubscription" ENABLE ROW LEVEL SECURITY;
