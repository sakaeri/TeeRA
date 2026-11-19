-- 請求書の宛名（現場の名前と請求先の名前が違う時だけ入れる。空なら依頼主名）
ALTER TABLE "CompanyRelationship" ADD COLUMN IF NOT EXISTS "invoiceRecipientName" TEXT;
