-- スタッフの請求書を同じ月に何枚でも出せるように（週払いなど）。何枚目か（sequence）と、「◯日まで」（periodEnd）
ALTER TABLE "StaffInvoice" ADD COLUMN IF NOT EXISTS "sequence" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StaffInvoice" ADD COLUMN IF NOT EXISTS "periodEnd" DATE;
DROP INDEX IF EXISTS "StaffInvoice_companyId_staffUserId_targetMonth_key";
CREATE UNIQUE INDEX IF NOT EXISTS "StaffInvoice_companyId_staffUserId_targetMonth_sequence_key" ON "StaffInvoice"("companyId", "staffUserId", "targetMonth", "sequence");
