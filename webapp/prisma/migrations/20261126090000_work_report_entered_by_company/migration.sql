-- スタッフが出していない業務報告を、会社が代わりに入力した時の入力者
ALTER TABLE "WorkReport" ADD COLUMN IF NOT EXISTS "enteredByCompanyUserId" TEXT;
