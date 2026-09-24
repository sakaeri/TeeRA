import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { todayJst } from "@/lib/date";
import {
  sendWorkReportSubmittedEmail,
  sendShiftRequestDigestEmail,
  sendPromoOrderEmail,
  sendShiftReminderEmail,
  sendUnsubmittedWorkReportReminderEmail,
  sendContractConsentReminderEmail,
} from "@/lib/email";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const APPROVE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日

function generateToken() {
  return randomBytes(24).toString("base64url");
}
function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
function absoluteUrl(path: string) {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${base}${path}`;
}

function shiftTimeLabel(shift: { isAllDay: boolean; isUndecided: boolean; startTime: string | null; endTime: string | null }) {
  if (shift.isUndecided) return "未定";
  if (shift.isAllDay) return "終日";
  return `${shift.startTime ?? "--:--"}〜${shift.endTime ?? "--:--"}`;
}

function formatJstTime(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(date);
}

// 業務報告に表示する時間は、シフトの予定時刻ではなく実際の打刻時刻を優先
// する（打刻がない場合のみ予定時刻にフォールバック）。
function reportTimeLabel(
  report: { clockIn: Date | null; clockOut: Date | null },
  shift: { isAllDay: boolean; isUndecided: boolean; startTime: string | null; endTime: string | null },
) {
  if (report.clockIn && report.clockOut) {
    return `${formatJstTime(report.clockIn)}〜${formatJstTime(report.clockOut)}`;
  }
  return shiftTimeLabel(shift);
}

// 日付(date列, @db.Date)＋"HH:mm"文字列を、そのカレンダー日のJST時刻として
// 実際のDateに合成する（withJstTimeと同じ考え方 — workReports.ts内は非公開
// なのでここでも小さく複製する。日付をまたぐシフトの終業側には使わない）。
function combineJstDateTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), h, m) - JST_OFFSET_MS);
}

// ①業務報告が届いたら即メール — 会社の「通知メールアドレス」が設定されて
// いる場合のみ送る（未設定の会社には一切送らない）。
export async function notifyCompanyOfWorkReportSubmission(workReportId: string) {
  console.log(`[email-notif] notifyCompanyOfWorkReportSubmission called workReportId=${workReportId}`);
  const report = await prisma.workReport.findUnique({
    where: { id: workReportId },
    include: { staff: true, shift: { include: { company: true } } },
  });
  if (!report) {
    console.log(`[email-notif] report not found for workReportId=${workReportId}`);
    return;
  }

  const company = report.shift.company;
  if (!company.notificationEmail) {
    console.log(`[email-notif] company ${company.id} has no notificationEmail set, skipping`);
    return;
  }
  console.log(`[email-notif] sending to ${company.notificationEmail} for company ${company.id}`);

  const token = generateToken();
  await prisma.accountActionToken.create({
    data: {
      tokenHash: hashToken(token),
      kind: "APPROVE_WORK_REPORT",
      workReportId: report.id,
      expiresAt: new Date(Date.now() + APPROVE_TOKEN_TTL_MS),
    },
  });

  await sendWorkReportSubmittedEmail(company.notificationEmail, {
    staffName: report.staff.name,
    date: report.shift.date.toISOString().slice(0, 10),
    timeLabel: reportTimeLabel(report, report.shift),
    taskLabel: report.taskName ?? report.shift.taskName ?? "（未指定）",
    approveUrl: absoluteUrl(`/email-actions/approve-work-report/${token}`),
    reviewUrl: absoluteUrl("/company/settings?tab=workreports"),
  });
}

// ③販促品の受注が入ったら即メール。
export async function notifyCompanyOfPromoOrder(redemptionId: string) {
  const redemption = await prisma.promoRedemption.findUnique({
    where: { id: redemptionId },
    include: { staff: true, promoItem: { include: { company: true } } },
  });
  if (!redemption) return;

  const company = redemption.promoItem.company;
  if (!company.notificationEmail) return;

  await sendPromoOrderEmail(company.notificationEmail, {
    staffName: redemption.staff.name,
    itemName: redemption.promoItem.name,
    reviewUrl: absoluteUrl("/company/settings?tab=promo"),
  });
}

// APPROVE_WORK_REPORTトークンの検証のみ（消費はしない）— メール内リンクを
// 開いた時点の確認画面表示用。メールプリフェッチ（セキュリティスキャナ等）
// によるGETだけでは承認が進まないよう、実際の承認は別途この画面のボタンを
// 押した時のPOST（Server Action）でのみ行う。
export async function getApproveWorkReportTokenInfo(token: string) {
  const record = await prisma.accountActionToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { workReport: { include: { staff: true, shift: { include: { company: true } } } } },
  });
  if (!record || record.kind !== "APPROVE_WORK_REPORT" || !record.workReport) return null;

  return {
    valid: !record.usedAt && record.expiresAt >= new Date() && record.workReport.approvalStatus === "PENDING",
    alreadyUsed: Boolean(record.usedAt) || record.workReport.approvalStatus !== "PENDING",
    expired: record.expiresAt < new Date(),
    workReportId: record.workReport.id,
    staffName: record.workReport.staff.name,
    companyName: record.workReport.shift.company.name,
    date: record.workReport.shift.date.toISOString().slice(0, 10),
    timeLabel: reportTimeLabel(record.workReport, record.workReport.shift),
    taskLabel: record.workReport.taskName ?? record.workReport.shift.taskName ?? "（未指定）",
  };
}

// 実際の承認はこちらでのみ行う（確認画面のボタンからのみ呼ばれる）。
export async function consumeApproveWorkReportToken(token: string) {
  const record = await prisma.accountActionToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.kind !== "APPROVE_WORK_REPORT" || record.usedAt || record.expiresAt < new Date() || !record.workReportId) {
    throw new Error("invalid_or_expired_token");
  }

  const { approveWorkReport } = await import("@/lib/domain/workReports");
  await approveWorkReport({ workReportId: record.workReportId });
  await prisma.accountActionToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
}

// ②シフト希望のたまり — 1件でも確定待ちがあれば、毎日1回のCronでまとめて
// お知らせする（しきい値なし。既存のダッシュボードの「やることリスト」と
// 同じ条件：PENDINGかつ希望日が1日でも今日以降残っているもの）。
export async function runShiftRequestDigest() {
  const today = new Date(`${todayJst()}T00:00:00.000Z`);
  const companies = await prisma.company.findMany({
    where: { notificationEmail: { not: null } },
    select: { id: true, notificationEmail: true },
  });

  for (const company of companies) {
    if (!company.notificationEmail) continue;
    const requests = await prisma.shiftRequest.findMany({
      where: { companyId: company.id, status: "PENDING" },
      select: { dates: true },
    });
    const count = requests.filter((r) => r.dates.some((d) => d >= today)).length;
    if (count === 0) continue;

    await sendShiftRequestDigestEmail(company.notificationEmail, count, absoluteUrl("/company"));
  }
}

// ④勤務開始1時間前リマインド（終日シフトは当日朝6:00に固定でリマインド）
// — 5〜10分おきのCronから呼ばれる想定。二重送信を避けるため、対象シフト
// にはreminderSentAtを記録する。
export async function runShiftStartReminders() {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 55 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 65 * 60 * 1000);
  const todayStr = todayJst();
  const tomorrow = new Date(`${todayStr}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const candidates = await prisma.shift.findMany({
    where: {
      status: "CONFIRMED",
      isUndecided: false,
      isAllDay: false,
      startTime: { not: null },
      reminderSentAt: null,
      date: { gte: new Date(`${todayStr}T00:00:00.000Z`), lte: tomorrow },
    },
    include: { staff: true, company: true },
  });

  for (const shift of candidates) {
    if (!shift.startTime) continue;
    const startAt = combineJstDateTime(shift.date, shift.startTime);
    if (startAt < windowStart || startAt > windowEnd) continue;

    await prisma.shift.update({ where: { id: shift.id }, data: { reminderSentAt: new Date() } });
    await sendShiftReminderEmail(shift.staff.email, {
      companyName: shift.company.name,
      date: shift.date.toISOString().slice(0, 10),
      timeLabel: shiftTimeLabel(shift),
      appUrl: absoluteUrl("/staff/timecard"),
    });
  }

  // 終日シフトは「開始時刻の1時間前」という基準が使えないため、当日朝
  // 6:00（±5分、5分おきのCronの実行間隔に合わせた許容幅）に固定でリマインド
  // する。
  const nowJstMinutesOfDay = Math.floor((now.getTime() + JST_OFFSET_MS) / 60000) % (24 * 60);
  if (Math.abs(nowJstMinutesOfDay - 6 * 60) <= 5) {
    const allDayCandidates = await prisma.shift.findMany({
      where: {
        status: "CONFIRMED",
        isAllDay: true,
        reminderSentAt: null,
        date: { gte: new Date(`${todayStr}T00:00:00.000Z`), lt: tomorrow },
      },
      include: { staff: true, company: true },
    });

    for (const shift of allDayCandidates) {
      await prisma.shift.update({ where: { id: shift.id }, data: { reminderSentAt: new Date() } });
      await sendShiftReminderEmail(shift.staff.email, {
        companyName: shift.company.name,
        date: shift.date.toISOString().slice(0, 10),
        timeLabel: shiftTimeLabel(shift),
        appUrl: absoluteUrl("/staff/timecard"),
        isAllDay: true,
      });
    }
  }
}

// ⑤未提出の業務報告リマインド（週次、スタッフ本人宛）— 出勤/退勤打刻済み
// なのに提出（submittedAt）まで済んでいないシフトをスタッフごとに集計する。
export async function runUnsubmittedWorkReportReminders() {
  const todayEnd = new Date(`${todayJst()}T23:59:59.999Z`);
  const shifts = await prisma.shift.findMany({
    where: {
      status: "CONFIRMED",
      date: { lte: todayEnd },
      OR: [{ workReport: null }, { workReport: { submittedAt: null } }],
    },
    include: { staff: true },
  });

  const byStaff = new Map<string, { email: string; count: number }>();
  for (const shift of shifts) {
    const entry = byStaff.get(shift.staffUserId) ?? { email: shift.staff.email, count: 0 };
    entry.count += 1;
    byStaff.set(shift.staffUserId, entry);
  }

  for (const { email, count } of byStaff.values()) {
    await sendUnsubmittedWorkReportReminderEmail(email, count, absoluteUrl("/staff/timecard"));
  }
}

// 契約書の同意待ちリマインド（週次、スタッフ本人宛）。
export async function runContractConsentReminders() {
  const pending = await prisma.staffContract.findMany({
    where: { status: "PENDING_CONSENT" },
    include: { staff: true, template: { include: { company: true } } },
  });

  const byStaff = new Map<string, { email: string; companyNames: Set<string> }>();
  for (const contract of pending) {
    const entry = byStaff.get(contract.staffUserId) ?? { email: contract.staff.email, companyNames: new Set<string>() };
    entry.companyNames.add(contract.template.company.name);
    byStaff.set(contract.staffUserId, entry);
  }

  for (const { email, companyNames } of byStaff.values()) {
    await sendContractConsentReminderEmail(email, Array.from(companyNames), absoluteUrl("/staff/contracts"));
  }
}
