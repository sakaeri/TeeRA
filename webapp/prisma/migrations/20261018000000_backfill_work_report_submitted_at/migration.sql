-- submittedAtは2026-09-09のマイグレーションで追加されたが既存行の補完をして
-- いなかったため、それ以前に提出された業務報告はsubmittedAtがNULLのまま。
-- 未承認一覧をsubmittedAtで絞るようにしたので、消えてしまわないよう補完する。
-- 欠勤/キャンセルの報告は提出時にしか作られないため、日付に関係なく提出済み。
UPDATE "WorkReport"
SET "submittedAt" = "updatedAt"
WHERE "submittedAt" IS NULL
  AND ("createdAt" < TIMESTAMP '2026-09-09 06:45:53' OR "outcome" <> 'WORKED');
