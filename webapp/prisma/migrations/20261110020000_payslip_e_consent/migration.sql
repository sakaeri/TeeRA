-- 給与明細の電子交付への同意
ALTER TABLE "CompanyMembership" ADD COLUMN IF NOT EXISTS "payslipEConsentAt" TIMESTAMP(3);
