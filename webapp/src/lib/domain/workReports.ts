import "server-only";
import { prisma } from "@/lib/prisma";
import { registerStaffTaskName, registerPlacementTaskName } from "@/lib/domain/contracts";
import { todayJst } from "@/lib/date";
import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

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

export async function clockOut(params: { shiftId: string; staffUserId: string; breakMinutes?: number }) {
  const report = await prisma.workReport.findUniqueOrThrow({ where: { shiftId: params.shiftId } });
  if (!report.clockIn) throw new Error("not_clocked_in");

  const clockOutAt = new Date();
  const breakMinutes = params.breakMinutes ?? report.breakMinutes;
  const rawMinutes = Math.round((clockOutAt.getTime() - report.clockIn.getTime()) / 60000);
  const computedMinutes = Math.max(rawMinutes - breakMinutes, 0);

  return prisma.workReport.update({
    where: { shiftId: params.shiftId },
    data: { clockOut: clockOutAt, breakMinutes, computedMinutes },
  });
}

// 業務報告を提出する — the three outcomes (出勤した / 欠勤 / 勤務先からのキャンセル)
// all route through this one flow into the same approval queue (chat24).
export async function submitWorkReport(params: {
  shiftId: string;
  staffUserId: string;
  outcome: "WORKED" | "ABSENT" | "CANCELLED_BY_EMPLOYER";
  comment?: string;
  taskName?: string;
}) {
  const existing = await prisma.workReport.findUnique({ where: { shiftId: params.shiftId } });

  if (params.outcome === "WORKED") {
    if (!existing?.clockIn || !existing?.clockOut) {
      throw new Error("clock_in_out_required");
    }
    if (params.taskName) {
      // 業務報告で選ばれた（または新規入力された）業務内容を単価表にも登録
      // しておく — こうしないと後で会社側が単価を設定しようとしたとき、
      // ここで入力された文字列と一致する候補が一覧に出てこない
      // （表記ゆれ対策の意味が無くなってしまう）。単価は付けず登録のみ。
      const shift = await prisma.shift.findUniqueOrThrow({ where: { id: params.shiftId } });
      await registerStaffTaskName({
        companyId: shift.companyId,
        staffUserId: params.staffUserId,
        taskName: params.taskName,
        companyRelationshipId: shift.companyRelationshipId ?? undefined,
      });
      if (shift.source === "CLIENT" && shift.companyRelationshipId) {
        await registerPlacementTaskName({
          companyId: shift.companyId,
          companyRelationshipId: shift.companyRelationshipId,
          taskName: params.taskName,
        });
      }
    }
    return prisma.workReport.update({
      where: { shiftId: params.shiftId },
      data: { outcome: "WORKED", comment: params.comment, taskName: params.taskName, approvalStatus: "PENDING" },
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
    },
    update: {
      outcome: params.outcome,
      computedMinutes: 0,
      comment: params.comment,
      approvalStatus: "PENDING",
    },
  });
}

// Mirrors resolveApproverCompanyId's branching as a WHERE clause instead of
// fetching every company's PENDING reports and resolving the approver one
// shift-lookup at a time in JS (an unbounded cross-company scan plus an N+1
// — this used to be the single most expensive part of a dashboard load,
// worse the more it's called, and it's called from several dashboard views).
export async function listPendingReportsForCompany(companyId: string) {
  return prisma.workReport.findMany({
    where: {
      approvalStatus: "PENDING",
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

export async function listOwnShiftsNeedingReport(staffUserId: string) {
  // 「今日」はJSTの暦日で判定する（date.tsの方針参照）。UTC基準のDate/
  // setUTCHours(23,59,59,999)だと、JSTの深夜0時〜朝9時台（UTC前日15〜23時
  // 台）は「今日」が前日扱いになり、今日の（JSTでの）シフトが一時的に一覧
  // から消えてしまっていた。
  const today = new Date(`${todayJst()}T23:59:59.999Z`);

  return prisma.shift.findMany({
    where: {
      staffUserId,
      status: "CONFIRMED",
      date: { lte: today },
    },
    include: { company: true, workReport: true },
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

export async function approveWorkReport(params: { workReportId: string; approverUserId: string }) {
  const report = await prisma.workReport.findUniqueOrThrow({ where: { id: params.workReportId } });

  return prisma.$transaction(async (tx) => {
    await tx.workReport.update({
      where: { id: report.id },
      data: {
        approvalStatus: "APPROVED",
        approverUserId: params.approverUserId,
        approvedAt: new Date(),
      },
    });

    await awardApprovalPoints(tx, report);

    return report;
  });
}

export async function rejectWorkReport(params: { workReportId: string; approverUserId: string }) {
  return prisma.workReport.update({
    where: { id: params.workReportId },
    data: {
      approvalStatus: "REJECTED",
      approverUserId: params.approverUserId,
      approvedAt: new Date(),
    },
  });
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

  return prisma.workReport.update({
    where: { id: params.workReportId },
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
}

// スタッフが企業側の修正内容に「これで合っています」と確認する —
// このタイミングで初めてAPPROVEDになる（企業の手修正だけでは確定しない）。
export async function confirmCorrectedWorkReport(params: { workReportId: string; staffUserId: string }) {
  const report = await prisma.workReport.findUniqueOrThrow({ where: { id: params.workReportId } });
  if (report.staffUserId !== params.staffUserId) throw new Error("forbidden");
  if (report.approvalStatus !== "NEEDS_CONFIRMATION") throw new Error("not_pending_confirmation");

  return prisma.$transaction(async (tx) => {
    await tx.workReport.update({
      where: { id: report.id },
      data: {
        approvalStatus: "APPROVED",
        approverUserId: report.correctedByUserId,
        approvedAt: new Date(),
      },
    });

    await awardApprovalPoints(tx, report);

    return report;
  });
}
