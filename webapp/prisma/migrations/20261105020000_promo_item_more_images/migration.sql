-- 販促品の画像を最大5枚に（4・5枚目を追加）
ALTER TABLE "PromoItem" ADD COLUMN IF NOT EXISTS "imageUrl4" TEXT;
ALTER TABLE "PromoItem" ADD COLUMN IF NOT EXISTS "imageUrl5" TEXT;
