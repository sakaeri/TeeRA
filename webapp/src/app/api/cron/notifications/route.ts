import {
  runShiftRequestDigest,
  runShiftStartReminders,
  runUnsubmittedReportPushReminders,
  runEveningUnsubmittedReminders,
  runUnsubmittedWorkReportReminders,
  runContractConsentReminders,
} from "@/lib/domain/emailNotifications";

// Vercelの無料(Hobby)プランのCronは1日1回までしか使えないため、この受付口は
// SupabaseのCron（pg_cron＋pg_net、webapp/supabase/notifications-cron.sql）から
// 5分おき・週1回で叩く。GitHub Actionsの定期実行（.github/workflows/
// notifications-cron.yml）は混雑時に数時間おきまで間引かれるため、5分おきの
// ジョブの予備としてだけ残している（各リマインドは送信済みの目印で二重送信しない）。CRON_SECRETを知らない第三者が実行できないよう、共有シークレット
// で簡易認証する。
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("cron not configured", { status: 500 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const job = url.searchParams.get("job");
  // 時刻で動きが変わるリマインド（朝6時・20時）を確かめるためのテスト用の
  // 現在時刻。本番では受け付けない。
  const nowParam = process.env.NODE_ENV !== "production" ? url.searchParams.get("now") : null;
  const now = nowParam ? new Date(nowParam) : new Date();

  switch (job) {
    case "shift-start-reminders":
      await runShiftStartReminders(now);
      // 退勤3時間後の未提出リマインド（同じ5分おきのジョブで動かす）
      await runUnsubmittedReportPushReminders();
      // 当日20時の未提出リマインド（退勤の打刻忘れも拾う）
      await runEveningUnsubmittedReminders(now);
      break;
    case "shift-request-digest":
      await runShiftRequestDigest();
      break;
    case "weekly-digest":
      await runUnsubmittedWorkReportReminders();
      await runContractConsentReminders();
      break;
    default:
      return new Response("unknown job", { status: 400 });
  }

  return new Response(JSON.stringify({ ok: true, job }), {
    headers: { "Content-Type": "application/json" },
  });
}
