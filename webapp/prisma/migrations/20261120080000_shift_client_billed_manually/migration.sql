-- 依頼主への請求をTeeRAの請求書以外で済ませた印（請求済みにする）
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "clientBilledManuallyAt" TIMESTAMP(3);
