-- 依頼主がオーダーを削除したときは止めずに取り消し、規定で「キャンセル不可」だったことを記録する
ALTER TABLE "ShiftCancellation" ADD COLUMN IF NOT EXISTS "ruleBlocked" BOOLEAN NOT NULL DEFAULT false;
