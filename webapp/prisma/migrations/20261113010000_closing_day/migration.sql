-- 締め日（1〜28日。NULLは末日締め）
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "payrollClosingDay" INTEGER;
ALTER TABLE "CompanyRelationship" ADD COLUMN IF NOT EXISTS "invoiceClosingDay" INTEGER;
ALTER TABLE "StaffInvoice" ADD COLUMN IF NOT EXISTS "periodRangeLabel" TEXT;
