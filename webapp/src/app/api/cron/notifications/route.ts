import {
  runShiftRequestDigest,
  runShiftStartReminders,
  runUnsubmittedWorkReportReminders,
  runContractConsentReminders,
} from "@/lib/domain/emailNotifications";

// Vercelの無料(Hobby)プランのCronは1日1回までしか使えないため、この受付口は
// GitHub Actionsの定期実行（.github/workflows/notifications-cron.yml）から
// 叩く想定。CRON_SECRETを知らない第三者が実行できないよう、共有シークレット
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

  const job = new URL(request.url).searchParams.get("job");

  switch (job) {
    case "shift-start-reminders":
      await runShiftStartReminders();
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
