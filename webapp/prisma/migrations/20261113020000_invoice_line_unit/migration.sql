-- 請求書の明細の数量の単位（HOUR=時間・DAY=日・COUNT=件）
ALTER TABLE "InvoiceLine" ADD COLUMN IF NOT EXISTS "unit" TEXT;
