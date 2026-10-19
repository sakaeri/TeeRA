import "server-only";
import { prisma } from "@/lib/prisma";
import { registerStaffTaskName, registerPlacementTaskName, isCoveredByBaseContract } from "@/lib/domain/contracts";
import { todayJst } from "@/lib/date";
import { timeRangesOverlap, releaseHeldShiftsOnReassign } from "@/lib/domain/shifts";
import { evaluateCancellation } from "@/lib/domain/cancellation";
import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 打刻の手動修正用 — referenceが表すJSTの暦日はそのまま保ち、時刻(HH:MM)
// だけをhhmmで置き換える。日付をまたぐシフト（深夜〜早朝）でも、押し忘れ
// を数十分〜数時間ずらすだけの軽微な補正である前提のため、暦日はいじらない。
function withJstTime(reference: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const jst = new Date(reference.getTime() + JST_OFFSET_MS);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), h, m) - JST_OFFSET_MS);
}

// Approval routing (permission-rules-memo.md, bugfixed in chat29): approver
// company is derived from the shift's source. INHOUSE -> the shift's own
// company. CLIENT -> the client company that placed the order, UNLESS that
// client is still a 仮アカウント (proxy, no real company yet) — in which
// case the agency (owner) company approves on the client's behalf.
export async function resolveApproverCompanyId(shiftId: string) {
  const shift = await prisma.shift.findUniqueOrThrow({
    where: { id: shiftId },
    include: { companyRelationship: true },
  });

  if (shift.source === "INHOUSE") return shift.companyId;

  const rel = shift.companyRelationship;
  if (!rel) return shift.companyId;
  return rel.clientCompanyId ?? rel.ownerCompanyId;
}

export async function clockIn(params: { shiftId: string; staffUserId: string }) {
  return prisma.workReport.upsert({
    where: { shiftId: params.shiftId },
    create: {
      shiftId: params.shiftId,
      staffUserId: params.staffUserId,
      outcome: "WORKED",
      clockIn: new Date(),
    },
    update: { clockIn: new Date() },
  });
}

// 休憩時間はここでは聞かない — 退勤の瞬間は正確な休憩分数をまだ把握して
// いないことが多いため、後段の業務報告提出時にまとめて確定させる
// （submitWorkReport側でcomputedMinutesを再計算する）。
export async function clockOut(params: { shiftId: string; staffUserId: string }) {
  const report = await prisma.workReport.findUniqueOrThrow({ where: { shiftId: params.shiftId } });
  if (!report.clockIn) throw new Error("not_clocked_in");

  const clockOutAt = new Date();
  const rawMinutes = Math.round((clockOutAt.getTime() - report.clockIn.getTime()) / 60000);
  const computedMinutes = Math.max(rawMinutes - report.breakMinutes, 0);

  return prisma.workReport.update({
    where: { shiftId: params.shiftId },
    data: { clockOut: clockOutAt, computedMinutes },
  });
}

// 業務報告を提出する — the three outcomes (出勤した / 欠勤 / 勤務先からのキャンセル)
// all route through this one flow into the same approval queue (chat24)。
// breakMinutesはWORKEDの時だけ意味を持ち、ここで最終確定してcomputedMinutes
// を打刻時刻から再計算する（退勤時点では休憩は未確定のまま0扱いだった）。
export async function submitWorkReport(params: {
  shiftId: string;
  staffUserId: string;
  outcome: "WORKED" | "ABSENT" | "CANCELLED_BY_EMPLOYER";
  comment?: string;
  taskName?: string;
  breakMinutes?: number;
  // 提出時にスタッフ自身が打刻時刻を手修正できるようにする（HH:MM）。
  // 承認/差し戻しという既存のチェック機構が最終的な歯止めになるため、
  // ここでは特別な検証やフラグ付けはせず、素直に上書きする。
  clockInTime?: string;
  clockOutTime?: string;
}) {
  const existing = await prisma.workReport.findUnique({ where: { shiftId: params.shiftId } });

  if (params.outcome === "WORKED") {
    const shift = await prisma.shift.findUniqueOrThrow({ where: { id: params.shiftId } });
    // 提出し忘れた過去のシフトを後日まとめて報告する場合、出退勤ボタンを
    // 一度も押していない（=WorkReportがまだ無いか、clockIn/clockOutが
    // 未記録）ことがある。その場合の基準日は「今日」ではなくシフト自体の
    // 予定日にする（そうしないと、ボタンを押した"今日"の日付がそのまま
    // 打刻の暦日として記録されてしまい、日付を正しく直す手段が無くなる）。
    // 出勤時刻より前の時刻表記で退勤時刻が入力された場合は、深夜またぎ
    // シフトとみなして退勤側の暦日を+1日する。
    const clockInBase = existing?.clockIn ?? shift.date;
    const clockIn = params.clockInTime ? withJstTime(clockInBase, params.clockInTime) : existing?.clockIn;

    let clockOutBase = existing?.clockOut ?? clockIn ?? shift.date;
    if (!existing?.clockOut && params.clockInTime && params.clockOutTime && params.clockOutTime < params.clockInTime) {
      clockOutBase = new Date(clockOutBase.getTime() + 24 * 60 * 60 * 1000);
    }
    const clockOut = params.clockOutTime ? withJstTime(clockOutBase, params.clockOutTime) : existing?.clockOut;

    if (!clockIn || !clockOut) {
      throw new Error("clock_in_out_required");
    }
    const breakMinutes = params.breakMinutes ?? existing?.breakMinutes ?? 0;
    const rawMinutes = Math.round((clockOut.getTime() - clockIn.getTime()) / 60000);
    if (rawMinutes <= 0) throw new Error("invalid_time_range");
    const computedMinutes = Math.max(rawMinutes - breakMinutes, 0);
    if (params.taskName) {
      // 業務報告で選ばれた（または新規入力された）業務内容を単価表にも登録
      // しておく — こうしないと後で会社側が単価を設定しようとしたとき、
      // ここで入力された文字列と一致する候補が一覧に出てこない
      // （表記ゆれ対策の意味が無くなってしまう）。単価は付けず登録のみ。
      // ただし、有効な雇用契約の業務内容と同じ名前の場合は登録しない —
      // 既に契約の基本給で完全にカバーされているのに「単価未設定」の行が
      // 重複して並び、基本給の表示と矛盾して見えてしまうため
      // （登録してしまうと、給与計算時にも設定漏れ扱いの警告が誤って出る）。
      const coveredByBaseContract = await isCoveredByBaseContract({
        companyId: shift.companyId,
        staffUserId: params.staffUserId,
        taskName: params.taskName,
      });
      if (!coveredByBaseContract) {
        await registerStaffTaskName({
          companyId: shift.companyId,
          staffUserId: params.staffUserId,
          taskName: params.taskName,
          companyRelationshipId: shift.companyRelationshipId ?? undefined,
        });
      }
      if (shift.source === "CLIENT" && shift.companyRelationshipId) {
        await registerPlacementTaskName({
          companyId: shift.companyId,
          companyRelationshipId: shift.companyRelationshipId,
          taskName: params.taskName,
        });
      }
    }
    // 出退勤ボタンを一度も押していない（=WorkReport行がまだ無い）状態から
    // 直接手入力で提出するケースがあるため、update前提だったここもupsertに
    // する（欠勤/キャンセルの分岐は元々upsertだった）。
    return prisma.workReport.upsert({
      where: { shiftId: params.shiftId },
      create: {
        shiftId: params.shiftId,
        staffUserId: params.staffUserId,
        outcome: "WORKED",
        comment: params.comment,
        taskName: params.taskName,
        clockIn,
        clockOut,
        breakMinutes,
        computedMinutes,
        approvalStatus: "PENDING",
        submittedAt: new Date(),
      },
      update: {
        outcome: "WORKED",
        comment: params.comment,
        taskName: params.taskName,
        clockIn,
        clockOut,
        breakMinutes,
        computedMinutes,
        approvalStatus: "PENDING",
        submittedAt: new Date(),
      },
    });
  }

  return prisma.workReport.upsert({
    where: { shiftId: params.shiftId },
    create: {
      shiftId: params.shiftId,
      staffUserId: params.staffUserId,
      outcome: params.outcome,
      computedMinutes: 0,
      comment: params.comment,
      submittedAt: new Date(),
    },
    update: {
      outcome: params.outcome,
      computedMinutes: 0,
      comment: params.comment,
      approvalStatus: "PENDING",
      submittedAt: new Date(),
    },
  });
}

// Mirrors resolveApproverCompanyId's branching as a WHERE clause instead of
// fetching every company's PENDING reports and resolving the approver one
// shift-lookup at a time in JS (an unbounded cross-company scan plus an N+1
// — this used to be the single most expensive part of a dashboard load,
// worse the more it's called, and it's called from several dashboard views).
// 出勤を打刻した時点でWorkReport行が既定値PENDINGで作られるため、
// submittedAtで「実際に提出されたもの」だけに絞る（打刻しただけの行が
// 未承認の業務報告として本部に並び、承認できてしまうのを防ぐ）。
export async function listPendingReportsForCompany(companyId: string) {
  return prisma.workReport.findMany({
    where: {
      approvalStatus: "PENDING",
      submittedAt: { not: null },
      shift: {
        OR: [
          { source: "INHOUSE", companyId },
          { source: "CLIENT", companyRelationshipId: null, companyId },
          { source: "CLIENT", companyRelationship: { clientCompanyId: companyId } },
          { source: "CLIENT", companyRelationship: { clientCompanyId: null, ownerCompanyId: companyId } },
        ],
      },
    },
    include: { shift: { include: { companyRelationship: true, team: true } }, staff: true },
    orderBy: { createdAt: "asc" },
  });
}

// カレンダーと同じく、所属する全社分のシフトをまとめて対象にする
// （companyIdsはlistMyMembershipsで取得した所属先ID一覧）。
export async function listOwnShiftsNeedingReport(staffUserId: string, companyIds: string[]) {
  // 「今日」はJSTの暦日で判定する（date.tsの方針参照）。UTC基準のDate/
  // setUTCHours(23,59,59,999)だと、JSTの深夜0時〜朝9時台（UTC前日15〜23時
  // 台）は「今日」が前日扱いになり、今日の（JSTでの）シフトが一時的に一覧
  // から消えてしまっていた。
  const today = new Date(`${todayJst()}T23:59:59.999Z`);

  return prisma.shift.findMany({
    where: {
      staffUserId,
      companyId: { in: companyIds },
      status: "CONFIRMED",
      date: { lte: today },
    },
    include: { company: true, workReport: true, companyRelationship: { include: { clientCompany: true } } },
    orderBy: { date: "desc" },
    take: 30,
  });
}

// Tiered staff points accrual on APPROVAL (not submission) — see
// 開発指示書/permission-rules-memo.md ④: 1pt for the 1st-300th cumulative
// approved report, 2pt for 301st-600th, 3pt for 601st+. Shared between
// approveWorkReport and confirmCorrectedWorkReport (both are "this report
// is now finalized as APPROVED" events).
async function awardApprovalPoints(tx: Tx, report: { id: string; staffUserId: string; outcome: string }) {
  if (report.outcome !== "WORKED") return;

  const priorApprovedCount = await tx.workReport.count({
    where: {
      staffUserId: report.staffUserId,
      outcome: "WORKED",
      approvalStatus: "APPROVED",
      id: { not: report.id },
    },
  });
  const cumulativeIndex = priorApprovedCount + 1;
  const points = cumulativeIndex <= 300 ? 1 : cumulativeIndex <= 600 ? 2 : 3;

  const account = await tx.staffPointsLedgerEntry.findFirst({
    where: { staffUserId: report.staffUserId },
    orderBy: { createdAt: "desc" },
  });
  const balanceAfter = (account?.balanceAfter ?? 0) + points;

  await tx.staffPointsLedgerEntry.create({
    data: {
      staffUserId: report.staffUserId,
      type: "EARN_REPORT_APPROVAL",
      points,
      balanceAfter,
      relatedWorkReportId: report.id,
    },
  });
}

// 「PENDING→APPROVED」の遷移とポイント付与を1回だけ行うことを保証する
// — 承認ボタンの二重クリック自体はクライアント側disabled={pending}で
// 防げるが、2つのタブ/2人の管理者がほぼ同時に承認した場合はサーバー側の
// ガードが無いと両方とも通ってポイントが二重付与されてしまう。
// updateManyのWHERE条件（approvalStatusがまだAPPROVEDでないこと）は
// Postgresの行ロックにより後勝ちのUPDATEが先勝ちのCOMMIT後に再評価される
// ため、2つ目の呼び出しはcount=0となりポイント付与をスキップできる。
// 承認・差し戻しとも、企業から動かせるのはPENDING（未承認の自己申告）から
// だけに限定する — NEEDS_CONFIRMATION（差し戻し後の企業修正・スタッフ確認
// 待ち）やREJECTED・APPROVEDから企業が直接動かせてしまうと、古い画面から
// の操作（レース条件）でスタッフの確認ステップを飛び越えて承認できてしまう
// （correctAndReturnWorkReportのコメント参照）。
// スタッフが「勤務先からのキャンセル」で報告した依頼主の現場のシフトは、
// 承認した時点で、その依頼主×業務内容のキャンセル規定からキャンセル料を
// 記録する（電話で受けた取り消しと同じく請求書に載る）。判定はスタッフが
// 報告した時点で行う。キャンセル不可の規定でも実際に取り消された以上、
// 料金の決めようがないので0円で記録だけ残す。
async function recordStaffReportedClientCancellation(
  tx: Tx,
  report: { shiftId: string; outcome: string; submittedAt: Date | null },
) {
  if (report.outcome !== "CANCELLED_BY_EMPLOYER") return;
  const shift = await tx.shift.findUniqueOrThrow({ where: { id: report.shiftId }, include: { cancellation: true } });
  if (shift.source !== "CLIENT" || shift.cancellation) return;
  const rule =
    shift.companyRelationshipId && shift.taskName
      ? await tx.companyPlacementRate.findFirst({
          where: { companyId: shift.companyId, companyRelationshipId: shift.companyRelationshipId, taskName: shift.taskName },
        })
      : null;
  const evaluation = evaluateCancellation(shift.date, rule, report.submittedAt ?? new Date());
  await tx.shiftCancellation.create({
    data: {
      shiftId: shift.id,
      cancelledByCompanyId: shift.companyId,
      source: "STAFF_REPORTED",
      feeAmount: evaluation.kind === "fee" ? evaluation.amount : 0,
    },
  });
}

export async function approveWorkReport(params: { workReportId: string; approverUserId?: string }) {
  return prisma.$transaction(async (tx) => {
    const report = await tx.workReport.findUniqueOrThrow({ where: { id: params.workReportId } });

    const result = await tx.workReport.updateMany({
      where: { id: report.id, approvalStatus: "PENDING", submittedAt: { not: null } },
      data: {
        approvalStatus: "APPROVED",
        approverUserId: params.approverUserId,
        approvedAt: new Date(),
      },
    });
    if (result.count === 0) throw new Error("not_pending");

    await awardApprovalPoints(tx, report);
    await recordStaffReportedClientCancellation(tx, report);

    return report;
  });
}

export async function rejectWorkReport(params: { workReportId: string; approverUserId: string; reason: string }) {
  const result = await prisma.workReport.updateMany({
    where: { id: params.workReportId, approvalStatus: "PENDING", submittedAt: { not: null } },
    data: {
      approvalStatus: "REJECTED",
      approverUserId: params.approverUserId,
      approvedAt: new Date(),
      rejectionReason: params.reason,
    },
  });
  if (result.count === 0) throw new Error("not_pending");
}

// 差し戻し時に企業が打刻・休憩時間を手修正する。企業は直接APPROVEDには
// できず、NEEDS_CONFIRMATIONに置いてスタッフの確認待ちにする——企業が
// 一方的に数字を確定できてしまうと「差し戻し」の意味が無くなり、
// スタッフに不利な方向へ勝手に書き換えられるリスクがあるため。
export async function correctAndReturnWorkReport(params: {
  workReportId: string;
  correctedByUserId: string;
  clockIn: Date;
  clockOut: Date;
  breakMinutes: number;
}) {
  const rawMinutes = Math.round((params.clockOut.getTime() - params.clockIn.getTime()) / 60000);
  const computedMinutes = Math.max(rawMinutes - params.breakMinutes, 0);

  // 承認・差し戻しと同じく、提出済みで未承認のものだけを修正できる。
  const result = await prisma.workReport.updateMany({
    where: { id: params.workReportId, approvalStatus: "PENDING", submittedAt: { not: null } },
    data: {
      clockIn: params.clockIn,
      clockOut: params.clockOut,
      breakMinutes: params.breakMinutes,
      computedMinutes,
      approvalStatus: "NEEDS_CONFIRMATION",
      correctedByUserId: params.correctedByUserId,
      correctedAt: new Date(),
    },
  });
  if (result.count === 0) throw new Error("not_pending");
}

// スタッフが企業側の修正内容に「これで合っています」と確認する —
// このタイミングで初めてAPPROVEDになる（企業の手修正だけでは確定しない）。
export async function confirmCorrectedWorkReport(params: { workReportId: string; staffUserId: string }) {
  const report = await prisma.workReport.findUniqueOrThrow({ where: { id: params.workReportId } });
  if (report.staffUserId !== params.staffUserId) throw new Error("forbidden");
  if (report.approvalStatus !== "NEEDS_CONFIRMATION") throw new Error("not_pending_confirmation");

  return prisma.$transaction(async (tx) => {
    const result = await tx.workReport.updateMany({
      where: { id: report.id, approvalStatus: "NEEDS_CONFIRMATION" },
      data: {
        approvalStatus: "APPROVED",
        approverUserId: report.correctedByUserId,
        approvedAt: new Date(),
      },
    });

    if (result.count > 0) {
      await awardApprovalPoints(tx, report);
    }

    return report;
  });
}

// 企業側の修正内容にスタッフが同意しない場合 — 差し戻し（REJECTED）に戻し、
// スタッフ自身が打刻・休憩を直して再提出できるようにする（企業が一方的に
// 数字を確定できないのと同じ考え方で、スタッフにも拒否する手段を残す）。
export const DISPUTED_CORRECTION_REASON =
  "会社の修正内容に同意できないとして差し戻されています。正しい時間に直して再提出してください。";

export async function disputeCorrectedWorkReport(params: { workReportId: string; staffUserId: string }) {
  const result = await prisma.workReport.updateMany({
    where: { id: params.workReportId, staffUserId: params.staffUserId, approvalStatus: "NEEDS_CONFIRMATION" },
    data: { approvalStatus: "REJECTED", rejectionReason: DISPUTED_CORRECTION_REASON },
  });
  if (result.count === 0) throw new Error("not_pending_confirmation");
}

// シフト外の勤務（緊急で出勤した等、シフトが作られていないまま働いた日）の
// 業務報告。報告と同時にシフト（createdVia=STAFF_REPORT）を作り、以降は通常の
// シフトの業務報告と全く同じ流れ（承認先の判定・給与/請求への反映）に乗せる。
// 勤務先は自社か、スタッフが配属されている依頼主のどちらか。
export async function submitUnscheduledWorkReport(params: {
  staffUserId: string;
  companyId: string;
  teamId?: string;
  companyRelationshipId?: string;
  date: string; // YYYY-MM-DD (JST)
  clockInTime: string; // HH:MM
  clockOutTime: string; // HH:MM
  breakMinutes: number;
  taskName?: string;
  comment?: string;
}) {
  if (params.date > todayJst()) throw new Error("future_date");
  if (!params.clockInTime || !params.clockOutTime || params.clockInTime === params.clockOutTime) {
    throw new Error("invalid_time_range");
  }

  if (params.companyRelationshipId) {
    const placement = await prisma.staffPlacement.findFirst({
      where: {
        staffUserId: params.staffUserId,
        active: true,
        companyRelationship: { id: params.companyRelationshipId, agencyCompanyId: params.companyId, status: "ACTIVE" },
      },
    });
    if (!placement) throw new Error("forbidden");
  }

  const date = new Date(`${params.date}T00:00:00.000Z`);
  // 深夜をまたぐ勤務（退勤が出勤より前の時刻）は、重複判定では当日の終わりまでとみなす
  const overlapEnd = params.clockOutTime > params.clockInTime ? params.clockOutTime : "23:59";

  const shift = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.staffUserId} || ':' || ${date.toISOString()}))`;
    const sameDay = await tx.shift.findMany({
      where: { staffUserId: params.staffUserId, date, status: "CONFIRMED" },
    });
    const overlapping = sameDay.filter((s) =>
      timeRangesOverlap(
        { startTime: params.clockInTime, endTime: overlapEnd, isAllDay: false, isUndecided: false },
        s,
      ),
    );
    // 同じ時間帯に既にシフトがあるなら、そちらの業務報告として出してもらう
    if (overlapping.length > 0) throw new Error("shift_exists");

    const created = await tx.shift.create({
      data: {
        companyId: params.companyId,
        teamId: params.teamId,
        staffUserId: params.staffUserId,
        source: params.companyRelationshipId ? "CLIENT" : "INHOUSE",
        companyRelationshipId: params.companyRelationshipId,
        taskName: params.taskName,
        date,
        startTime: params.clockInTime,
        endTime: params.clockOutTime,
        createdVia: "STAFF_REPORT",
      },
    });
    await releaseHeldShiftsOnReassign(tx, params.staffUserId, date);
    return created;
  });

  try {
    return await submitWorkReport({
      shiftId: shift.id,
      staffUserId: params.staffUserId,
      outcome: "WORKED",
      comment: params.comment,
      taskName: params.taskName,
      breakMinutes: params.breakMinutes,
      clockInTime: params.clockInTime,
      clockOutTime: params.clockOutTime,
    });
  } catch (error) {
    // 報告の作成に失敗した場合、報告の無いシフトだけが残らないよう取り消す
    await prisma.workReport.deleteMany({ where: { shiftId: shift.id } });
    await prisma.shift.delete({ where: { id: shift.id } });
    throw error;
  }
}

function formatJstDateTime(date: Date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${jst.toISOString().slice(11, 16)}`;
}

function formatJstClock(date: Date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

// スタッフ詳細の稼働履歴・カレンダーの日別詳細から開く、業務報告の詳細。
// 差し戻した後は承認待ち一覧から消えてしまい、理由を確認する場所が
// 無かったため、経緯（提出・時間修正・承認/差し戻し）とあわせて返す。
// 理由・修正の記録は最新の1回分しか保存していない。
export async function getWorkReportDetail(shiftId: string) {
  const shift = await prisma.shift.findUniqueOrThrow({
    where: { id: shiftId },
    include: {
      staff: true,
      companyRelationship: { include: { clientCompany: true } },
      workReport: { include: { approver: true, corrector: true } },
    },
  });
  const r = shift.workReport;
  const submitted = Boolean(r && (r.submittedAt || r.approvalStatus !== "PENDING"));

  const timeline: { label: string; at: string | null; by: string | null; note?: string }[] = [];
  if (r && submitted) {
    if (r.submittedAt) timeline.push({ label: "提出", at: formatJstDateTime(r.submittedAt), by: shift.staff.name });
    if (r.correctedAt) {
      timeline.push({ label: "時間を修正", at: formatJstDateTime(r.correctedAt), by: r.corrector?.name ?? null });
    }
    if (r.approvalStatus === "APPROVED" && r.approvedAt) {
      timeline.push({
        label: "承認",
        at: formatJstDateTime(r.approvedAt),
        // 承認者が記録されていないのは、ログインせずに通知メールのリンクから承認したもの
        by: r.approver?.name ?? "通知メールのリンクから承認",
      });
    }
    if (r.approvalStatus === "REJECTED") {
      const disputed = r.rejectionReason === DISPUTED_CORRECTION_REASON;
      timeline.push(
        disputed
          ? {
              label: "差戻し",
              at: formatJstDateTime(r.updatedAt),
              by: shift.staff.name,
              note: "スタッフが修正内容に同意しませんでした（内容が違う）",
            }
          : {
              label: "差戻し",
              at: r.approvedAt ? formatJstDateTime(r.approvedAt) : null,
              by: r.approver?.name ?? null,
              note: r.rejectionReason ?? undefined,
            },
      );
    }
  }

  return {
    date: shift.date.toISOString().slice(0, 10),
    staffName: shift.staff.name,
    workplaceLabel:
      shift.source === "INHOUSE"
        ? "自社"
        : (shift.companyRelationship?.clientCompany?.name ?? shift.companyRelationship?.proxyName ?? "依頼主"),
    taskName: r?.taskName ?? shift.taskName,
    submitted,
    outcome: submitted ? r!.outcome : null,
    approvalStatus: submitted ? r!.approvalStatus : null,
    clockIn: r?.clockIn ? formatJstClock(r.clockIn) : null,
    clockOut: r?.clockOut ? formatJstClock(r.clockOut) : null,
    breakMinutes: r?.breakMinutes ?? 0,
    computedMinutes: r?.computedMinutes ?? 0,
    comment: r?.comment ?? null,
    timeline,
    // 再提出されて承認待ちに戻った場合も、前回の差し戻し理由は参考に出す
    previousRejectionReason:
      submitted && r!.approvalStatus !== "REJECTED" && r!.rejectionReason
        ? r!.rejectionReason === DISPUTED_CORRECTION_REASON
          ? "スタッフが修正内容に同意しませんでした（内容が違う）"
          : r!.rejectionReason
        : null,
  };
}

export type WorkReportDetail = Awaited<ReturnType<typeof getWorkReportDetail>>;
