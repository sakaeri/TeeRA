-- スタッフの請求書で✅を外した勤務（未請求のまま残り、次の請求書に入る）
ALTER TABLE "StaffInvoice" ADD COLUMN IF NOT EXISTS "excludedShiftIds" JSONB NOT NULL DEFAULT '[]';
