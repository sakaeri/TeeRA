-- 業務報告の承認のタイミング（仮の依頼主ごと：その都度／月末にまとめて）
ALTER TABLE "CompanyRelationship" ADD COLUMN IF NOT EXISTS "reportApprovalTiming" TEXT NOT NULL DEFAULT 'EACH';
