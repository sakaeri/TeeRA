-- 退勤から3時間たっても未提出のときのプッシュ通知の送信記録
ALTER TABLE "WorkReport" ADD COLUMN "submitReminderSentAt" TIMESTAMP(3);
