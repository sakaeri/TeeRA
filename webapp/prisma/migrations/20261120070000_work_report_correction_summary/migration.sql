-- 会社が業務報告を直した時に変えた項目（経緯の表示用）
ALTER TABLE "WorkReport" ADD COLUMN IF NOT EXISTS "correctionSummary" TEXT;
