-- 派遣会社が依頼主の代わりに出すオーダー：どの依頼主（現場）のオーダーか
ALTER TABLE "PublicRecruitment" ADD COLUMN IF NOT EXISTS "companyRelationshipId" TEXT;

DO $$ BEGIN
  ALTER TABLE "PublicRecruitment" ADD CONSTRAINT "PublicRecruitment_companyRelationshipId_fkey" FOREIGN KEY ("companyRelationshipId") REFERENCES "CompanyRelationship"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- シフトを入れた会社（依頼主のカレンダーに「派遣会社が入力」と出すため）
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "createdByCompanyId" TEXT;
