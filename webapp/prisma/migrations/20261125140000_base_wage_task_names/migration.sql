-- 給料明細の単価未設定の案内で「基本給のままでいい」にした業務内容（次から聞かない）
ALTER TABLE "CompanyMembership" ADD COLUMN IF NOT EXISTS "baseWageTaskNames" JSONB NOT NULL DEFAULT '[]';
