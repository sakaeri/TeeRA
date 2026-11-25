-- 発行履歴から「削除」した過去の発行分（画面に出さないだけ。記録は残す）
ALTER TABLE "SalarySlipIssue" ADD COLUMN IF NOT EXISTS "hiddenAt" TIMESTAMP(3);
ALTER TABLE "InvoiceIssue" ADD COLUMN IF NOT EXISTS "hiddenAt" TIMESTAMP(3);
