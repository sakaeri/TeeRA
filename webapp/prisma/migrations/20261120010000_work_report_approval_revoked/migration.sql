-- 承認の取り消し（いつ・誰が）
ALTER TABLE "WorkReport" ADD COLUMN IF NOT EXISTS "approvalRevokedAt" TIMESTAMP(3);
ALTER TABLE "WorkReport" ADD COLUMN IF NOT EXISTS "approvalRevokedByUserId" TEXT;
