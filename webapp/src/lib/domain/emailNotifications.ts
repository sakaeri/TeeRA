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
import { sendPushToUser, sendPushToUsers } from "@/lib/push";

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

// 公開募集（オーダー/公開どちらも）経由のシフトのみ、応募条件/服装/持ち物/
// 集合場所などの詳細をリマインドメールにも載せる — 募集ページを開き直さ
// なくても当日必要な持ち物・服装を確認できるようにするため。
function recruitmentEmailDetails(recruitment: { note: string | null; extraItems: unknown } | null) {
  if (!recruitment) return { recruitmentNote: null, recruitmentExtraItems: [] };
  return {
    recruitmentNote: recruitment.note,
    recruitmentExtraItems: recruitment.extraItems as { label: string; value: string }[],
  };
}

// プッシュ通知は（会社の共有受信箱宛のメールと違い）ログイン中の本部
// 管理者/編集者の端末にしか届けられないため、送信先はその会社の
// COMPANY_ADMIN/COMPANY_EDITORのuserId一覧に読み替える。
async function companyAdminUserIds(companyId: string) {
  const members = await prisma.companyMembership.findMany({
    where: { companyId, role: { in: ["COMPANY_ADMIN", "COMPANY_EDITOR"] } },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

// チーム宛の通知（業務報告の提出・シフト希望の未確定）をプッシュで届ける
// 先 — そのチームのTEAM_MANAGER/TEAM_LEADERのuserId一覧。
async function teamManagerUserIds(teamId: string) {
  const members = await prisma.teamMembership.findMany({
    where: { teamId, role: { in: ["TEAM_MANAGER", "TEAM_LEADER"] } },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
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

// 欠勤・勤務先からのキャンセルはtimeLabelが予定時刻や「未定」にフォール
// バックするだけで結果自体が伝わらない（メール・承認確認ページどちらも
// 見た目上は普通の出勤報告と区別がつかなかった）ため、outcomeを別枠で
// はっきり伝える。WORKEDの場合はnull（従来通り時間だけ見せる）。
const NON_WORKED_OUTCOME_LABEL: Record<string, string> = {
  ABSENT: "欠勤",
  CANCELLED_BY_EMPLOYER: "勤務先からのキャンセル",
};
function reportOutcomeLabel(report: { outcome: string }): string | null {
  return NON_WORKED_OUTCOME_LABEL[report.outcome] ?? null;
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
    include: { staff: true, shift: { include: { company: true, team: true } } },
  });
  if (!report) {
    console.log(`[email-notif] report not found for workReportId=${workReportId}`);
    return;
  }

  const company = report.shift.company;
  const team = report.shift.team;

  // チーム所属のシフトは、そのチームに通知先メアド・マネージャー/リーダー
  // がいればそちらへ届け、本部へは送らない（本部は業務報告キューでいつでも
  // 全件確認できるため、関係ないチームの通知で受信箱・プッシュが埋まる
  // のを避ける）。チーム未設定のシフト、またはチームに通知先メアドが
  // 無い場合は、これまでどおり本部のnotificationEmail・本部管理者/編集者
  // へのプッシュにフォールバックする。
  const destinationEmail = team?.notificationEmail || company.notificationEmail;

  if (destinationEmail) {
    console.log(`[email-notif] sending to ${destinationEmail} for company ${company.id}${team ? ` team ${team.id}` : ""}`);

    const token = generateToken();
    await prisma.accountActionToken.create({
      data: {
        tokenHash: hashToken(token),
        kind: "APPROVE_WORK_REPORT",
        workReportId: report.id,
        expiresAt: new Date(Date.now() + APPROVE_TOKEN_TTL_MS),
      },
    });

    await sendWorkReportSubmittedEmail(destinationEmail, {
      companyName: company.name,
      staffName: report.staff.name,
      date: report.shift.date.toISOString().slice(0, 10),
      timeLabel: reportTimeLabel(report, report.shift),
      outcomeLabel: reportOutcomeLabel(report),
      taskLabel: report.taskName ?? report.shift.taskName ?? "（未指定）",
      approveUrl: absoluteUrl(`/email-actions/approve-work-report/${token}`),
      reviewUrl: absoluteUrl("/company/settings?tab=workreports"),
    });
  } else {
    console.log(`[email-notif] company ${company.id} has no notificationEmail set, skipping email`);
  }

  const pushTargetUserIds = team ? await teamManagerUserIds(team.id) : await companyAdminUserIds(company.id);
  await sendPushToUsers(pushTargetUserIds, {
    title: "業務報告が届きました",
    body: `${report.staff.name}さん（${report.shift.date.toISOString().slice(0, 10)}）`,
    url: "/company/settings?tab=workreports",
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
    companyName: company.name,
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
    outcomeLabel: reportOutcomeLabel(record.workReport),
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
  // メール（notificationEmail宛）だけでなくpush（ログイン中の本部管理者/
  // 編集者宛）でも届けるようになったため、notificationEmail未設定の会社も
  // 対象に含める。
  const companies = await prisma.company.findMany({
    select: { id: true, name: true, notificationEmail: true },
  });

  for (const company of companies) {
    const requests = await prisma.shiftRequest.findMany({
      where: { companyId: company.id, status: "PENDING" },
      select: { teamId: true, dates: true },
    });
    const pending = requests.filter((r) => r.dates.some((d) => d >= today));
    const totalCount = pending.length;
    if (totalCount === 0) continue;

    // 会社全体の集計はこれまでどおり本部へ（メール＋本部管理者/編集者への
    // プッシュ）。チームごとの内訳は本部へは送らず、下でチームごとに
    // 個別に届ける（本部は全体件数だけ把握できればよく、関係ないチームの
    // 内訳で受信箱・プッシュが埋まらないようにする）。
    if (company.notificationEmail) {
      await sendShiftRequestDigestEmail(company.notificationEmail, company.name, totalCount, absoluteUrl("/company"));
    }
    await sendPushToUsers(await companyAdminUserIds(company.id), {
      title: "未確定のシフト希望があります",
      body: `${company.name}：${totalCount}件`,
      url: "/company",
    });

    const countByTeamId = new Map<string, number>();
    for (const r of pending) {
      if (!r.teamId) continue;
      countByTeamId.set(r.teamId, (countByTeamId.get(r.teamId) ?? 0) + 1);
    }
    for (const [teamId, count] of countByTeamId) {
      const team = await prisma.team.findUnique({ where: { id: teamId }, select: { name: true, notificationEmail: true } });
      if (!team) continue;
      if (team.notificationEmail) {
        await sendShiftRequestDigestEmail(team.notificationEmail, `${company.name}（${team.name}）`, count, absoluteUrl("/company"));
      }
      await sendPushToUsers(await teamManagerUserIds(teamId), {
        title: "未確定のシフト希望があります",
        body: `${team.name}：${count}件`,
        url: "/company",
      });
    }
  }
}

// ④勤務開始1時間前リマインド（終日シフトは当日朝6:00以降にリマインド）
// — 5〜10分おきのCronから呼ばれる想定だったが、実際にはGitHub Actionsの
// 高頻度スケジュールは公式に間引かれ、数時間おきにしか実行されないことが
// ある（実際にこれが原因で終日シフトの6:00リマインドが丸ごと届かない
// 事故が発生した）。「ちょうど◯分前/◯時ちょうど」という狭い時刻一致では
// その狭い窓をCronの実行タイミングが外れただけで通知が消えてしまうため、
// 「基準時刻を過ぎていて、まだ送っていなければ送る」という判定に緩めて
// いる。二重送信を避けるため、対象シフトにはreminderSentAtを記録する。
export async function runShiftStartReminders() {
  const now = new Date();
  const todayStr = todayJst();
  const tomorrow = new Date(`${todayStr}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  // 「開始1時間前」ちょうどではなく、開始4時間前〜開始2時間後を対象にする
  // （Cronが数時間単位で間引かれても、いずれかの実行がこの窓に入るように
  // 幅を持たせている）。開始2時間を過ぎたら今更感があるので諦める。
  const REMIND_BEFORE_MS = 4 * 60 * 60 * 1000;
  const GIVE_UP_AFTER_MS = 2 * 60 * 60 * 1000;

  const candidates = await prisma.shift.findMany({
    where: {
      status: "CONFIRMED",
      isUndecided: false,
      isAllDay: false,
      startTime: { not: null },
      reminderSentAt: null,
      date: { gte: new Date(`${todayStr}T00:00:00.000Z`), lte: tomorrow },
    },
    include: { staff: true, company: true, publicRecruitment: true },
  });

  for (const shift of candidates) {
    if (!shift.startTime) continue;
    const startAt = combineJstDateTime(shift.date, shift.startTime);
    const remindAt = new Date(startAt.getTime() - REMIND_BEFORE_MS);
    const giveUpAt = new Date(startAt.getTime() + GIVE_UP_AFTER_MS);
    if (now < remindAt || now > giveUpAt) continue;
    if (shift.staff.isProxy) continue;

    await prisma.shift.update({ where: { id: shift.id }, data: { reminderSentAt: new Date() } });
    await sendShiftReminderEmail(shift.staff.email, {
      staffName: shift.staff.name,
      companyName: shift.company.name,
      date: shift.date.toISOString().slice(0, 10),
      timeLabel: shiftTimeLabel(shift),
      taskLabel: shift.taskName,
      appUrl: absoluteUrl("/staff/timecard"),
      ...recruitmentEmailDetails(shift.publicRecruitment),
    });
    await sendPushToUser(shift.staffUserId, {
      title: "まもなくシフト開始です",
      body: `${shift.date.toISOString().slice(0, 10)} ${shiftTimeLabel(shift)}${shift.taskName ? " " + shift.taskName : ""}`,
      url: "/staff/timecard",
    });
  }

  // 終日シフトは「開始時刻の◯時間前」という基準が使えないため、当日朝
  // 6:00以降ならいつでも対象にする（同じ理由で「6:00ちょうど」に固定しない）。
  const nowJstMinutesOfDay = Math.floor((now.getTime() + JST_OFFSET_MS) / 60000) % (24 * 60);
  if (nowJstMinutesOfDay >= 6 * 60) {
    const allDayCandidates = await prisma.shift.findMany({
      where: {
        status: "CONFIRMED",
        isAllDay: true,
        reminderSentAt: null,
        date: { gte: new Date(`${todayStr}T00:00:00.000Z`), lt: tomorrow },
      },
      include: { staff: true, company: true, publicRecruitment: true },
    });

    for (const shift of allDayCandidates) {
      if (shift.staff.isProxy) continue;
      await prisma.shift.update({ where: { id: shift.id }, data: { reminderSentAt: new Date() } });
      await sendShiftReminderEmail(shift.staff.email, {
        staffName: shift.staff.name,
        companyName: shift.company.name,
        date: shift.date.toISOString().slice(0, 10),
        timeLabel: shiftTimeLabel(shift),
        taskLabel: shift.taskName,
        appUrl: absoluteUrl("/staff/timecard"),
        isAllDay: true,
        ...recruitmentEmailDetails(shift.publicRecruitment),
      });
      await sendPushToUser(shift.staffUserId, {
        title: "本日のシフトがあります",
        body: `${shift.date.toISOString().slice(0, 10)} 終日${shift.taskName ? " " + shift.taskName : ""}`,
        url: "/staff/timecard",
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

  const byStaff = new Map<string, { email: string; name: string; count: number }>();
  for (const shift of shifts) {
    if (shift.staff.isProxy) continue;
    const entry = byStaff.get(shift.staffUserId) ?? { email: shift.staff.email, name: shift.staff.name, count: 0 };
    entry.count += 1;
    byStaff.set(shift.staffUserId, entry);
  }

  for (const { email, name, count } of byStaff.values()) {
    await sendUnsubmittedWorkReportReminderEmail(email, name, count, absoluteUrl("/staff/timecard"));
  }
}

// 契約書の同意待ちリマインド（週次、スタッフ本人宛）。
export async function runContractConsentReminders() {
  const pending = await prisma.staffContract.findMany({
    where: { status: "PENDING_CONSENT" },
    include: { staff: true, template: { include: { company: true } } },
  });

  const byStaff = new Map<string, { email: string; name: string; companyNames: Set<string> }>();
  for (const contract of pending) {
    if (contract.staff.isProxy) continue;
    const entry = byStaff.get(contract.staffUserId) ?? {
      email: contract.staff.email,
      name: contract.staff.name,
      companyNames: new Set<string>(),
    };
    entry.companyNames.add(contract.template.company.name);
    byStaff.set(contract.staffUserId, entry);
  }

  for (const { email, name, companyNames } of byStaff.values()) {
    await sendContractConsentReminderEmail(email, name, Array.from(companyNames), absoluteUrl("/staff/contracts"));
  }
}
