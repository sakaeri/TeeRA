-- CreateEnum
CREATE TYPE "CompanyRole" AS ENUM ('COMPANY_ADMIN', 'COMPANY_EDITOR', 'STAFF');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('TEAM_MANAGER', 'TEAM_LEADER', 'TEAM_MEMBER');

-- CreateEnum
CREATE TYPE "RelationshipStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "WageType" AS ENUM ('HOURLY', 'DAILY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "InviteKind" AS ENUM ('STAFF', 'COMPANY_ADMIN_TRANSFER', 'CLIENT_UPGRADE', 'AGENCY_UPGRADE');

-- CreateEnum
CREATE TYPE "ShiftSource" AS ENUM ('INHOUSE', 'CLIENT');

-- CreateEnum
CREATE TYPE "ShiftCreatedVia" AS ENUM ('ASSIGN', 'STAFF_APPLICATION', 'PUBLIC_RECRUIT_ENTRY');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ShiftRequestDesire" AS ENUM ('WORK', 'OFF');

-- CreateEnum
CREATE TYPE "ShiftRequestStatus" AS ENUM ('PENDING', 'MATCHED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "RecruitmentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'STOPPED', 'DELETED');

-- CreateEnum
CREATE TYPE "RecruitmentEntryStatus" AS ENUM ('APPLIED', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WorkReportOutcome" AS ENUM ('WORKED', 'ABSENT', 'CANCELLED_BY_EMPLOYER');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('PART_TIME', 'FIXED_TERM_EMPLOYEE', 'FULL_TIME', 'CONTRACTOR', 'DISPATCH_STAFF');

-- CreateEnum
CREATE TYPE "WorkplaceType" AS ENUM ('INHOUSE', 'CLIENT');

-- CreateEnum
CREATE TYPE "ContractScheduleType" AS ENUM ('FIXED', 'SHIFT');

-- CreateEnum
CREATE TYPE "ContractPeriodType" AS ENUM ('INDEFINITE', 'FIXED_TERM');

-- CreateEnum
CREATE TYPE "ContractTemplateStatus" AS ENUM ('ACTIVE', 'LOCKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StaffContractStatus" AS ENUM ('PENDING_CONSENT', 'ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "SalarySlipStatus" AS ENUM ('DRAFT', 'FINALIZED', 'ISSUED');

-- CreateEnum
CREATE TYPE "SalarySlipLineKind" AS ENUM ('SHIFT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'ISSUED');

-- CreateEnum
CREATE TYPE "TeeLedgerEntryType" AS ENUM ('CHARGE_CARD', 'CHARGE_BANK_CONFIRMED', 'LOCK_RECRUITMENT', 'UNLOCK_REFUND_RECRUITMENT', 'CONSUME_SALARY_ISSUE', 'CONSUME_INVOICE_ISSUE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BankTransferStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StripeChargeStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "StaffPointsLedgerEntryType" AS ENUM ('EARN_REPORT_APPROVAL', 'REDEEM_PROMO', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PromoRedemptionStatus" AS ENUM ('PENDING_SHIPMENT', 'SHIPPED');

-- CreateEnum
CREATE TYPE "TodoKind" AS ENUM ('MANUAL', 'AUTO_SHORTAGE', 'AUTO_SHIFT_UNCONFIRMED', 'AUTO_WORK_REPORT', 'AUTO_CONTRACT', 'AUTO_PROMO');

-- CreateEnum
CREATE TYPE "TodoStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agencyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "dispatchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "invoiceRegistrationNumber" TEXT,
    "teeBalance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" "CompanyRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'TEAM_MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyRelationship" (
    "id" TEXT NOT NULL,
    "agencyCompanyId" TEXT NOT NULL,
    "clientCompanyId" TEXT,
    "proxyName" TEXT,
    "status" "RelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyPlacementRate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "companyRelationshipId" TEXT,
    "taskName" TEXT NOT NULL,
    "wageType" "WageType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyPlacementRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InviteToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "kind" "InviteKind" NOT NULL,
    "companyId" TEXT NOT NULL,
    "teamId" TEXT,
    "companyRelationshipId" TEXT,
    "targetRole" "CompanyRole",
    "createdByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "teamId" TEXT,
    "staffUserId" TEXT NOT NULL,
    "source" "ShiftSource" NOT NULL,
    "companyRelationshipId" TEXT,
    "date" DATE NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "isUndecided" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "status" "ShiftStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdVia" "ShiftCreatedVia" NOT NULL,
    "publicRecruitmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictOverride" (
    "id" TEXT NOT NULL,
    "newShiftId" TEXT NOT NULL,
    "overriddenShiftId" TEXT NOT NULL,
    "confirmedByUserId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConflictOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftRequest" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "teamId" TEXT,
    "desire" "ShiftRequestDesire" NOT NULL,
    "dates" DATE[],
    "note" TEXT,
    "status" "ShiftRequestStatus" NOT NULL DEFAULT 'PENDING',
    "matchedShiftId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicRecruitment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "teamId" TEXT,
    "title" TEXT NOT NULL,
    "jobDescription" TEXT,
    "date" DATE NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "hourlyWage" INTEGER,
    "maxEntries" INTEGER NOT NULL,
    "perEntryTeeCost" INTEGER NOT NULL DEFAULT 10,
    "lockedTee" INTEGER NOT NULL,
    "status" "RecruitmentStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicRecruitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentEntry" (
    "id" TEXT NOT NULL,
    "publicRecruitmentId" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "status" "RecruitmentEntryStatus" NOT NULL DEFAULT 'APPLIED',
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "resultingShiftId" TEXT,

    CONSTRAINT "RecruitmentEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkReport" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "outcome" "WorkReportOutcome" NOT NULL,
    "clockIn" TIMESTAMP(3),
    "clockOut" TIMESTAMP(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "computedMinutes" INTEGER NOT NULL DEFAULT 0,
    "comment" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approverUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "employmentType" "EmploymentType" NOT NULL,
    "workplaceType" "WorkplaceType" NOT NULL,
    "companyRelationshipId" TEXT,
    "jobDescription" TEXT NOT NULL,
    "scheduleType" "ContractScheduleType" NOT NULL,
    "workStartTime" TEXT,
    "workEndTime" TEXT,
    "actualWorkMinutes" INTEGER,
    "breakMinutes" INTEGER,
    "hasOvertime" BOOLEAN NOT NULL DEFAULT false,
    "overtimeNote" TEXT,
    "fixedWeekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "shiftPatternNote" TEXT,
    "restNote" TEXT,
    "wageType" "WageType" NOT NULL,
    "wageAmount" INTEGER NOT NULL,
    "paymentClosingDay" TEXT,
    "paymentDay" TEXT,
    "paymentMethod" TEXT,
    "contractPeriodType" "ContractPeriodType" NOT NULL,
    "contractStartDate" DATE NOT NULL,
    "contractEndDate" DATE,
    "hasRenewal" BOOLEAN NOT NULL DEFAULT false,
    "probationPeriodNote" TEXT,
    "extraItems" JSONB NOT NULL DEFAULT '[]',
    "status" "ContractTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "parentTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffContract" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "wageAmountSnapshot" INTEGER NOT NULL,
    "consentedAt" TIMESTAMP(3),
    "status" "StaffContractStatus" NOT NULL DEFAULT 'PENDING_CONSENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalarySlip" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "targetMonth" TEXT NOT NULL,
    "status" "SalarySlipStatus" NOT NULL DEFAULT 'DRAFT',
    "deductions" JSONB NOT NULL DEFAULT '[]',
    "paidLeaveDaysUsed" INTEGER NOT NULL DEFAULT 0,
    "paidLeaveDailyRate" INTEGER NOT NULL DEFAULT 0,
    "paidLeaveGrantDays" INTEGER NOT NULL DEFAULT 10,
    "carriedOverFromMonth" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalarySlip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalarySlipLine" (
    "id" TEXT NOT NULL,
    "salarySlipId" TEXT NOT NULL,
    "shiftId" TEXT,
    "kind" "SalarySlipLineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "rate" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalarySlipLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalarySlipIssue" (
    "id" TEXT NOT NULL,
    "salarySlipId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "chargedTee" BOOLEAN NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalarySlipIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "issuingCompanyId" TEXT NOT NULL,
    "companyRelationshipId" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "invoiceRegistrationNumberSnapshot" TEXT,
    "dueDate" DATE,
    "note" TEXT,
    "invoicedShiftIds" JSONB NOT NULL DEFAULT '[]',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "shiftId" TEXT,
    "staffName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "rate" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "taxRatePercent" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceIssue" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeeLedgerEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "TeeLedgerEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "publicRecruitmentId" TEXT,
    "stripeChargeId" TEXT,
    "bankTransferRequestId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeeLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransferRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "teeAmount" INTEGER NOT NULL,
    "yenAmount" INTEGER NOT NULL,
    "status" "BankTransferStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransferRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeCharge" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT NOT NULL,
    "yenAmount" INTEGER NOT NULL,
    "teeAmount" INTEGER NOT NULL,
    "status" "StripeChargeStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffPointsLedgerEntry" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "type" "StaffPointsLedgerEntryType" NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "relatedWorkReportId" TEXT,
    "relatedRedemptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffPointsLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pointsCost" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoRedemption" (
    "id" TEXT NOT NULL,
    "promoItemId" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "pointsSpent" INTEGER NOT NULL,
    "status" "PromoRedemptionStatus" NOT NULL DEFAULT 'PENDING_SHIPMENT',
    "shippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TodoItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "teamId" TEXT,
    "kind" "TodoKind" NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" DATE,
    "recipientUserId" TEXT,
    "createdByUserId" TEXT,
    "imageUrl" TEXT,
    "status" "TodoStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TodoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TodoComment" (
    "id" TEXT NOT NULL,
    "todoItemId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TodoComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "Company_name_idx" ON "Company"("name");

-- CreateIndex
CREATE INDEX "Team_companyId_idx" ON "Team"("companyId");

-- CreateIndex
CREATE INDEX "CompanyMembership_companyId_role_idx" ON "CompanyMembership"("companyId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMembership_userId_companyId_key" ON "CompanyMembership"("userId", "companyId");

-- CreateIndex
CREATE INDEX "TeamMembership_userId_idx" ON "TeamMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMembership_teamId_userId_key" ON "TeamMembership"("teamId", "userId");

-- CreateIndex
CREATE INDEX "CompanyRelationship_agencyCompanyId_idx" ON "CompanyRelationship"("agencyCompanyId");

-- CreateIndex
CREATE INDEX "CompanyRelationship_clientCompanyId_idx" ON "CompanyRelationship"("clientCompanyId");

-- CreateIndex
CREATE INDEX "CompanyPlacementRate_companyId_idx" ON "CompanyPlacementRate"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "InviteToken_token_key" ON "InviteToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "InviteToken_usedByUserId_key" ON "InviteToken"("usedByUserId");

-- CreateIndex
CREATE INDEX "InviteToken_companyId_idx" ON "InviteToken"("companyId");

-- CreateIndex
CREATE INDEX "Shift_staffUserId_date_idx" ON "Shift"("staffUserId", "date");

-- CreateIndex
CREATE INDEX "Shift_companyId_date_idx" ON "Shift"("companyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ConflictOverride_newShiftId_key" ON "ConflictOverride"("newShiftId");

-- CreateIndex
CREATE UNIQUE INDEX "ConflictOverride_overriddenShiftId_key" ON "ConflictOverride"("overriddenShiftId");

-- CreateIndex
CREATE INDEX "ShiftRequest_staffUserId_idx" ON "ShiftRequest"("staffUserId");

-- CreateIndex
CREATE INDEX "ShiftRequest_companyId_idx" ON "ShiftRequest"("companyId");

-- CreateIndex
CREATE INDEX "PublicRecruitment_companyId_status_idx" ON "PublicRecruitment"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RecruitmentEntry_publicRecruitmentId_staffUserId_key" ON "RecruitmentEntry"("publicRecruitmentId", "staffUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkReport_shiftId_key" ON "WorkReport"("shiftId");

-- CreateIndex
CREATE INDEX "WorkReport_staffUserId_idx" ON "WorkReport"("staffUserId");

-- CreateIndex
CREATE INDEX "WorkReport_approvalStatus_idx" ON "WorkReport"("approvalStatus");

-- CreateIndex
CREATE INDEX "ContractTemplate_companyId_idx" ON "ContractTemplate"("companyId");

-- CreateIndex
CREATE INDEX "StaffContract_staffUserId_idx" ON "StaffContract"("staffUserId");

-- CreateIndex
CREATE INDEX "StaffContract_templateId_idx" ON "StaffContract"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "SalarySlip_companyId_staffUserId_targetMonth_key" ON "SalarySlip"("companyId", "staffUserId", "targetMonth");

-- CreateIndex
CREATE INDEX "TeeLedgerEntry_companyId_createdAt_idx" ON "TeeLedgerEntry"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StripeCharge_stripePaymentIntentId_key" ON "StripeCharge"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "StaffPointsLedgerEntry_staffUserId_createdAt_idx" ON "StaffPointsLedgerEntry"("staffUserId", "createdAt");

-- CreateIndex
CREATE INDEX "TodoItem_companyId_status_idx" ON "TodoItem"("companyId", "status");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyRelationship" ADD CONSTRAINT "CompanyRelationship_agencyCompanyId_fkey" FOREIGN KEY ("agencyCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyRelationship" ADD CONSTRAINT "CompanyRelationship_clientCompanyId_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPlacementRate" ADD CONSTRAINT "CompanyPlacementRate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPlacementRate" ADD CONSTRAINT "CompanyPlacementRate_companyRelationshipId_fkey" FOREIGN KEY ("companyRelationshipId") REFERENCES "CompanyRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteToken" ADD CONSTRAINT "InviteToken_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteToken" ADD CONSTRAINT "InviteToken_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteToken" ADD CONSTRAINT "InviteToken_companyRelationshipId_fkey" FOREIGN KEY ("companyRelationshipId") REFERENCES "CompanyRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteToken" ADD CONSTRAINT "InviteToken_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteToken" ADD CONSTRAINT "InviteToken_usedByUserId_fkey" FOREIGN KEY ("usedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_companyRelationshipId_fkey" FOREIGN KEY ("companyRelationshipId") REFERENCES "CompanyRelationship"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_publicRecruitmentId_fkey" FOREIGN KEY ("publicRecruitmentId") REFERENCES "PublicRecruitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictOverride" ADD CONSTRAINT "ConflictOverride_newShiftId_fkey" FOREIGN KEY ("newShiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictOverride" ADD CONSTRAINT "ConflictOverride_overriddenShiftId_fkey" FOREIGN KEY ("overriddenShiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictOverride" ADD CONSTRAINT "ConflictOverride_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRequest" ADD CONSTRAINT "ShiftRequest_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRequest" ADD CONSTRAINT "ShiftRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftRequest" ADD CONSTRAINT "ShiftRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicRecruitment" ADD CONSTRAINT "PublicRecruitment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicRecruitment" ADD CONSTRAINT "PublicRecruitment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentEntry" ADD CONSTRAINT "RecruitmentEntry_publicRecruitmentId_fkey" FOREIGN KEY ("publicRecruitmentId") REFERENCES "PublicRecruitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentEntry" ADD CONSTRAINT "RecruitmentEntry_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkReport" ADD CONSTRAINT "WorkReport_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkReport" ADD CONSTRAINT "WorkReport_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkReport" ADD CONSTRAINT "WorkReport_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractTemplate" ADD CONSTRAINT "ContractTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractTemplate" ADD CONSTRAINT "ContractTemplate_companyRelationshipId_fkey" FOREIGN KEY ("companyRelationshipId") REFERENCES "CompanyRelationship"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractTemplate" ADD CONSTRAINT "ContractTemplate_parentTemplateId_fkey" FOREIGN KEY ("parentTemplateId") REFERENCES "ContractTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffContract" ADD CONSTRAINT "StaffContract_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ContractTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffContract" ADD CONSTRAINT "StaffContract_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalarySlip" ADD CONSTRAINT "SalarySlip_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalarySlip" ADD CONSTRAINT "SalarySlip_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalarySlipLine" ADD CONSTRAINT "SalarySlipLine_salarySlipId_fkey" FOREIGN KEY ("salarySlipId") REFERENCES "SalarySlip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalarySlipLine" ADD CONSTRAINT "SalarySlipLine_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalarySlipIssue" ADD CONSTRAINT "SalarySlipIssue_salarySlipId_fkey" FOREIGN KEY ("salarySlipId") REFERENCES "SalarySlip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_issuingCompanyId_fkey" FOREIGN KEY ("issuingCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyRelationshipId_fkey" FOREIGN KEY ("companyRelationshipId") REFERENCES "CompanyRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceIssue" ADD CONSTRAINT "InvoiceIssue_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeeLedgerEntry" ADD CONSTRAINT "TeeLedgerEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeeLedgerEntry" ADD CONSTRAINT "TeeLedgerEntry_publicRecruitmentId_fkey" FOREIGN KEY ("publicRecruitmentId") REFERENCES "PublicRecruitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeeLedgerEntry" ADD CONSTRAINT "TeeLedgerEntry_stripeChargeId_fkey" FOREIGN KEY ("stripeChargeId") REFERENCES "StripeCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeeLedgerEntry" ADD CONSTRAINT "TeeLedgerEntry_bankTransferRequestId_fkey" FOREIGN KEY ("bankTransferRequestId") REFERENCES "BankTransferRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransferRequest" ADD CONSTRAINT "BankTransferRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StripeCharge" ADD CONSTRAINT "StripeCharge_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPointsLedgerEntry" ADD CONSTRAINT "StaffPointsLedgerEntry_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoItem" ADD CONSTRAINT "PromoItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_promoItemId_fkey" FOREIGN KEY ("promoItemId") REFERENCES "PromoItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TodoItem" ADD CONSTRAINT "TodoItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TodoItem" ADD CONSTRAINT "TodoItem_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TodoItem" ADD CONSTRAINT "TodoItem_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TodoItem" ADD CONSTRAINT "TodoItem_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TodoComment" ADD CONSTRAINT "TodoComment_todoItemId_fkey" FOREIGN KEY ("todoItemId") REFERENCES "TodoItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TodoComment" ADD CONSTRAINT "TodoComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
