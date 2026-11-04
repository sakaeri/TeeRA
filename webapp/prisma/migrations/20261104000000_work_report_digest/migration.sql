-- 業務報告の通知メールを1日1回のまとめにする（送る時刻は会社ごとに選ぶ）
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "workReportDigestHour" INTEGER NOT NULL DEFAULT 18;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "workReportDigestSentAt" TIMESTAMP(3);
