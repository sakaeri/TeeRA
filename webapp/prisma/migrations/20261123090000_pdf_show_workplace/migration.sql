-- 給料明細・業務委託の請求書の明細に勤務先を載せるか（falseなら業務内容だけ）
ALTER TABLE "SalarySlip" ADD COLUMN IF NOT EXISTS "showWorkplace" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StaffInvoice" ADD COLUMN IF NOT EXISTS "showWorkplace" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompanyMembership" ADD COLUMN IF NOT EXISTS "contractorInvoiceShowWorkplace" BOOLEAN NOT NULL DEFAULT true;
