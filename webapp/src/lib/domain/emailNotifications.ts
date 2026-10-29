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
  sendClientCancellationEmail,
  sendShiftTimeChangedEmail,
  sendClientTimeChangeEmail,
} from "@/lib/email";
import type { RecruitmentCancelImpact } from "@/lib/domain/cancellation";
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
// viewerUserIdは確認画面を開いている人（ログイン中なら）。承認する会社の
// メンバーであれば承認者として記録する（未ログインならリンクからの承認として
// 承認者は空のまま）。
export async function consumeApproveWorkReportToken(token: string, viewerUserId?: string) {
  const record = await prisma.accountActionToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { workReport: true },
  });
  if (!record || record.kind !== "APPROVE_WORK_REPORT" || record.usedAt || record.expiresAt < new Date() || !record.workReportId) {
    throw new Error("invalid_or_expired_token");
  }

  const { approveWorkReport, resolveApproverCompanyId } = await import("@/lib/domain/workReports");
  let approverUserId: string | undefined;
  if (viewerUserId && record.workReport) {
    const approverCompanyId = await resolveApproverCompanyId(record.workReport.shiftId);
    const membership = await prisma.companyMembership.findFirst({
      where: { userId: viewerUserId, companyId: approverCompanyId },
    });
    if (membership) approverUserId = viewerUserId;
  }
  await approveWorkReport({ workReportId: record.workReportId, approverUserId });
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
export async function runShiftStartReminders(now = new Date()) {
  const todayStr = new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
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

  // 終日・時間未定のシフトは「開始時刻の◯時間前」という基準が使えないため、
  // 当日朝6:00以降ならいつでも対象にする（同じ理由で「6:00ちょうど」に固定
  // しない）。以前は時間未定のシフトがどちらの対象にも入らず、朝のリマインドが
  // 一切届いていなかった。
  const nowJstMinutesOfDay = Math.floor((now.getTime() + JST_OFFSET_MS) / 60000) % (24 * 60);
  if (nowJstMinutesOfDay >= 6 * 60) {
    const allDayCandidates = await prisma.shift.findMany({
      where: {
        status: "CONFIRMED",
        OR: [{ isAllDay: true }, { isUndecided: true }, { startTime: null }],
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
        body: `${shift.date.toISOString().slice(0, 10)} ${shiftTimeLabel(shift)}${shift.taskName ? " " + shift.taskName : ""}`,
        url: "/staff/timecard",
      });
    }
  }
}

// 退勤から3時間たっても業務報告が出ていなければ、本人にプッシュ通知で
// 知らせる（1件につき1回だけ）。5分おきのリマインドと一緒に動かす。
// Cronが間引かれても拾えるよう「3時間を過ぎていて未送信なら送る」判定にし、
// 古すぎるもの（2日以上前の退勤）は今更なので対象外にする（初回の一斉送信も防ぐ）。
// 当日20時のリマインドと合わせて、未提出のプッシュは1シフトにつき1回だけ
// （どちらかが送ったらShift.reportReminderSentAtを付け、もう片方は送らない）。
export async function runUnsubmittedReportPushReminders() {
  const now = Date.now();
  const reports = await prisma.workReport.findMany({
    where: {
      submittedAt: null,
      submitReminderSentAt: null,
      clockOut: { lte: new Date(now - 3 * 60 * 60 * 1000), gte: new Date(now - 2 * 24 * 60 * 60 * 1000) },
      shift: { status: "CONFIRMED", reportReminderSentAt: null },
      staff: { isProxy: false },
    },
    include: { shift: { include: { company: true } } },
  });

  for (const report of reports) {
    await prisma.workReport.update({ where: { id: report.id }, data: { submitReminderSentAt: new Date() } });
    await prisma.shift.update({ where: { id: report.shiftId }, data: { reportReminderSentAt: new Date() } });
    await sendPushToUser(report.staffUserId, {
      title: "業務報告がまだ提出されていません",
      body: `${report.shift.date.toISOString().slice(0, 10)} ${report.shift.company.name}の業務報告を提出してください`,
      url: "/staff/timecard",
    });
  }
}

// 当日20時になっても業務報告が提出されていないシフトを、本人にプッシュ
// 通知で知らせる（メールは週1回のまとめだけにする）。退勤の打刻を忘れた日は
// 「退勤3時間後」のリマインドが動かないため、その取りこぼしをここで拾う。
// 「退勤3時間後」をすでに送ったシフトには送らない（未提出のプッシュは1シフト1回だけ）。
// Cronが間引かれても拾えるよう「20時を過ぎていて未送信なら送る」判定にし、
// 対象は当日分だけにする（翌日以降は週次のまとめメールに任せる）。
// まだ勤務中（終了予定が今より後）のシフトは対象外。
export async function runEveningUnsubmittedReminders(now = new Date()) {
  const nowJstMinutesOfDay = Math.floor((now.getTime() + JST_OFFSET_MS) / 60000) % (24 * 60);
  if (nowJstMinutesOfDay < 20 * 60) return;
  const nowHHMM = `${String(Math.floor(nowJstMinutesOfDay / 60)).padStart(2, "0")}:${String(nowJstMinutesOfDay % 60).padStart(2, "0")}`;
  const todayStr = new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);

  const shifts = await prisma.shift.findMany({
    where: {
      status: "CONFIRMED",
      date: new Date(`${todayStr}T00:00:00.000Z`),
      reportReminderSentAt: null,
      staff: { isProxy: false },
      OR: [{ workReport: null }, { workReport: { submittedAt: null } }],
    },
    include: { staff: true, company: true },
  });

  const byStaff = new Map<string, { companyNames: Set<string>; shiftIds: string[] }>();
  for (const shift of shifts) {
    if (shift.endTime && !shift.isAllDay && !shift.isUndecided && shift.endTime > nowHHMM) continue;
    const entry = byStaff.get(shift.staffUserId) ?? { companyNames: new Set<string>(), shiftIds: [] };
    entry.companyNames.add(shift.company.name);
    entry.shiftIds.push(shift.id);
    byStaff.set(shift.staffUserId, entry);
  }

  for (const [staffUserId, entry] of byStaff) {
    await prisma.shift.updateMany({ where: { id: { in: entry.shiftIds } }, data: { reportReminderSentAt: new Date() } });
    const companies = Array.from(entry.companyNames).join("、");
    await sendPushToUser(staffUserId, {
      title: "今日の業務報告がまだ提出されていません",
      body: `${todayStr} ${companies}の業務報告を提出してください`,
      url: "/staff/timecard",
    });
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

// 依頼主がオーダーを取り消して派遣元のスタッフのシフトが取り消された時、
// 派遣元（本部・通知先メール）に知らせる。
export async function notifyAgencyOfClientCancellation(params: {
  clientName: string;
  impacts: RecruitmentCancelImpact[];
}) {
  const byAgency = new Map<string, RecruitmentCancelImpact[]>();
  for (const impact of params.impacts) {
    const list = byAgency.get(impact.agencyCompanyId) ?? [];
    list.push(impact);
    byAgency.set(impact.agencyCompanyId, list);
  }

  for (const [agencyCompanyId, impacts] of byAgency) {
    const company = await prisma.company.findUnique({ where: { id: agencyCompanyId } });
    if (!company) continue;
    const lines = impacts.map((i) => {
      const fee = i.evaluation.kind === "fee" ? `（キャンセル料${i.evaluation.amount.toLocaleString()}円）` : "";
      const handling = i.staffHandling === "HOLD" ? "（調整中：振り替えるか休みにするかを決めてください）" : "（休み）";
      return `${i.date.toISOString().slice(0, 10)} ${i.staffName}さん${i.taskName ? `・${i.taskName}` : ""}${fee}${handling}`;
    });
    const totalFee = impacts.reduce((sum, i) => sum + (i.evaluation.kind === "fee" ? i.evaluation.amount : 0), 0);
    if (company.notificationEmail) {
      await sendClientCancellationEmail(company.notificationEmail, {
        companyName: company.name,
        clientName: params.clientName,
        lines,
        totalFee,
        reviewUrl: absoluteUrl("/company/calendar"),
      });
    }
    await sendPushToUsers(await companyAdminUserIds(agencyCompanyId), {
      title: "依頼主がシフトを取り消しました",
      body: `${params.clientName}：${lines.join("、")}`,
      url: "/company/calendar",
    });
  }

  // スタッフには「休みにする」扱いの分だけ知らせる。「調整中」の分は派遣元が
  // 振り替え先を決めるまで知らせない（通知が来た時点で休みと勘違いさせないため）。
  for (const impact of params.impacts) {
    if (impact.staffHandling !== "RELEASE") continue;
    await notifyStaffShiftReleased({ staffUserId: impact.staffUserId, date: impact.date, workplaceName: params.clientName });
  }
}

// シフトが無くなって休みになったことをスタッフ本人に知らせる。
export async function notifyStaffShiftReleased(params: { staffUserId: string; date: Date; workplaceName: string | null }) {
  await sendPushToUser(params.staffUserId, {
    title: "シフトがなくなりました",
    body: `${params.date.toISOString().slice(0, 10)}${params.workplaceName ? `の${params.workplaceName}` : ""}のシフトはなくなりました（休み）。`,
    url: "/staff",
  });
}

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

// シフトの出勤時間が決まった・変わったことをスタッフ本人に知らせる。見逃すと
// 遅刻につながるため毎回送る。プッシュ通知を受け取れる端末が無い人には、
// 代わりにメールで送る。
export async function notifyStaffShiftTimeChanged(params: {
  shiftId: string;
  previous: { isAllDay: boolean; isUndecided: boolean; startTime: string | null; endTime: string | null };
}) {
  const shift = await prisma.shift.findUniqueOrThrow({
    where: { id: params.shiftId },
    include: { staff: true, company: true, companyRelationship: { include: { clientCompany: true } } },
  });
  if (shift.staff.isProxy) return;
  const dateLabel = `${shift.date.getUTCMonth() + 1}月${shift.date.getUTCDate()}日（${WEEKDAY_JA[shift.date.getUTCDay()]}）`;
  const workplace =
    shift.companyRelationship?.clientCompany?.name ?? shift.companyRelationship?.proxyName ?? shift.company.name;
  const newLabel = shiftTimeLabel(shift);
  const previousLabel = shiftTimeLabel(params.previous);
  const decided = params.previous.isUndecided && !shift.isUndecided;
  const title = decided ? "出勤時間が決まりました" : "出勤時間が変わりました";
  const body = decided
    ? `${dateLabel}の${workplace}の出勤時間は ${newLabel} です。`
    : `${dateLabel}の${workplace}の出勤時間が ${previousLabel} から ${newLabel} に変わりました。`;

  const pushDevices = await prisma.pushSubscription.count({ where: { userId: shift.staffUserId } });
  if (pushDevices > 0) {
    await sendPushToUser(shift.staffUserId, { title, body, url: "/staff" });
    return;
  }
  await sendShiftTimeChangedEmail(shift.staff.email, {
    staffName: shift.staff.name,
    title,
    intro: body,
    dateLabel,
    workplace,
    timeLabel: newLabel,
    previousTimeLabel: decided ? null : previousLabel,
    taskLabel: shift.taskName,
    appUrl: absoluteUrl("/staff"),
  });
}

// 依頼主が、派遣会社の入れたシフトの出勤時間を入力・変更したことを派遣会社に知らせる
// （派遣会社が知らないうちに自社スタッフの時間が変わらないようにする）。
export async function notifyAgencyOfClientTimeChange(params: {
  shiftId: string;
  previous: { isAllDay: boolean; isUndecided: boolean; startTime: string | null; endTime: string | null };
}) {
  const shift = await prisma.shift.findUniqueOrThrow({
    where: { id: params.shiftId },
    include: { staff: true, company: true, companyRelationship: { include: { clientCompany: true } } },
  });
  const clientName = shift.companyRelationship?.clientCompany?.name ?? "依頼主";
  const dateLabel = `${shift.date.getUTCMonth() + 1}月${shift.date.getUTCDate()}日（${WEEKDAY_JA[shift.date.getUTCDay()]}）`;
  const line = `${dateLabel} ${shift.staff.name}さん${shift.taskName ? `・${shift.taskName}` : ""}：${shiftTimeLabel(params.previous)} → ${shiftTimeLabel(shift)}`;
  if (shift.company.notificationEmail) {
    await sendClientTimeChangeEmail(shift.company.notificationEmail, {
      companyName: shift.company.name,
      clientName,
      line,
      reviewUrl: absoluteUrl("/company/calendar"),
    });
  }
  await sendPushToUsers(await companyAdminUserIds(shift.companyId), {
    title: "依頼主が出勤時間を変更しました",
    body: `${clientName}：${line}`,
    url: "/company/calendar",
  });
}
