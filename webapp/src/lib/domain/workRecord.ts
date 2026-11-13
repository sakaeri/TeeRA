import "server-only";
import { prisma } from "@/lib/prisma";
import { reportDisplay } from "@/lib/workReportDisplay";
import type { CalendarPdfShift } from "@/lib/pdf/calendar";

type WorkRecordShift = {
  date: Date;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  isUndecided: boolean;
  status: string;
  taskName: string | null;
  staff: { name: string };
  cancellation: { feeAmount: number | null } | null;
  workReport: (NonNullable<Parameters<typeof reportDisplay>[0]> & { outcome: string; approvalStatus: string; computedMinutes?: number | null }) | null;
  companyRelationship: { proxyName: string | null; clientCompany: { name: string } | null } | null;
};

export const workRecordShiftInclude = {
  staff: true,
  workReport: true,
  cancellation: true,
  companyRelationship: { include: { clientCompany: true } },
} as const;

function isCancelled(s: WorkRecordShift) {
  return Boolean(s.cancellation) || s.status === "CANCELLED" || s.status === "ON_HOLD";
}

// 実績表の1行（キャンセル料のかかった取消は「取消（キャンセル料あり）」、出勤は報告の時間）
export function workRecordRow(s: WorkRecordShift): CalendarPdfShift {
  const base: CalendarPdfShift = {
    date: s.date.toISOString().slice(0, 10),
    staffName: s.staff.name,
    startTime: s.startTime,
    endTime: s.endTime,
    isAllDay: s.isAllDay,
    isUndecided: s.isUndecided,
    clientName: s.companyRelationship?.clientCompany?.name ?? s.companyRelationship?.proxyName ?? null,
    taskName: s.taskName,
  };
  if (isCancelled(s)) return { ...base, timeOverride: "取消（キャンセル料あり）" };
  const shown = reportDisplay(s.workReport);
  return {
    ...base,
    taskName: shown.reportedTaskName ?? s.taskName,
    outcome: shown.outcome,
    reportedTimeLabel: shown.reportedTimeLabel,
    workedMinutes: s.workReport?.outcome === "WORKED" ? (s.workReport.computedMinutes ?? 0) : 0,
  };
}

// 請求の対象になる実績（承認済みの出勤と、キャンセル料が発生した取消）だけを残す
export function isBillableWorkRecord(s: WorkRecordShift) {
  if (isCancelled(s)) return (s.cancellation?.feeAmount ?? 0) > 0;
  return s.workReport?.outcome === "WORKED" && s.workReport.approvalStatus === "APPROVED";
}

// 請求書に載ったシフトの実績表（請求書の明細と中身が必ず合うよう、明細のシフトだけを出す）
export async function workRecordRowsForShiftIds(shiftIds: string[]) {
  if (shiftIds.length === 0) return [];
  const shifts = await prisma.shift.findMany({
    where: { id: { in: shiftIds } },
    include: workRecordShiftInclude,
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
  return shifts.map(workRecordRow);
}
