-- 給与明細PDFの勤務内訳を勤務先・業務ごとにまとめるか（falseならシフト1件ずつ）
ALTER TABLE "SalarySlip" ADD COLUMN IF NOT EXISTS "groupShiftLines" BOOLEAN NOT NULL DEFAULT true;
