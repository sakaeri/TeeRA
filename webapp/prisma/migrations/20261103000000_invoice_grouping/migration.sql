-- 請求書PDFの明細を業務ごとにまとめるか、実績表を付けるか
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "groupLinesByTask" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "attachWorkRecord" BOOLEAN NOT NULL DEFAULT true;
