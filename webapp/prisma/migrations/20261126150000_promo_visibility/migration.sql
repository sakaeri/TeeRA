-- 販促品の掲載先（自社スタッフのみ／フリー掲載）
ALTER TABLE "PromoItem" ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'OWN_STAFF';
