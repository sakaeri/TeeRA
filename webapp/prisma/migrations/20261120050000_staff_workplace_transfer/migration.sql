-- スタッフが業務報告で勤務先を変えた（振替）記録
ALTER TABLE "WorkReport" ADD COLUMN IF NOT EXISTS "workplaceChangedByStaff" BOOLEAN NOT NULL DEFAULT false;
-- 振替で取り消しになった元のシフト：キャンセル料を会社が確認するまで true
ALTER TABLE "ShiftCancellation" ADD COLUMN IF NOT EXISTS "transferredByStaff" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ShiftCancellation" ADD COLUMN IF NOT EXISTS "feeReviewPending" BOOLEAN NOT NULL DEFAULT false;
