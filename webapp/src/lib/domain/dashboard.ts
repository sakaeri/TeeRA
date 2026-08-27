import "server-only";
import { prisma } from "@/lib/prisma";
import { listPendingReportsForCompany } from "@/lib/domain/workReports";
import { listStaffWithSummary } from "@/lib/domain/roster";

// 仮アカウント（isProxy）は本人ログインができず自己サービスの同意フローに
// 乗れない一時的なプレースホルダーなので、本アカウント連携されるまで
// 契約書未確認からは除外する。
export async function listPendingContractStaff(companyId: string) {
  const staff = await listStaffWithSummary(companyId);
  return staff
    .filter((s) => s.contractStatus === "未送付" && !s.isProxy)
    .map((s) => ({ userId: s.userId, name: s.name }));
}

// The dashboard needs the same underlying queues (shortage recruitments,
// shift requests, pending reports, pending contracts) for several different
// views (KPI counts, the auto-generated to-do rows, and each KPI card's own
// popup list). Fetching them once here and deriving every view from the
// same in-memory result — instead of each view independently re-querying —
// is what keeps the dashboard's page load to a handful of round trips
// instead of the same handful of queries repeated 3-4x over.
export async function loadDashboardData(companyId: string) {
  const [shortageRecruitments, shiftRequests, pendingReports, pendingContractStaff] = await Promise.all([
    prisma.publicRecruitment.findMany({
      where: { companyId, status: "PUBLISHED" },
      include: { entries: true },
      orderBy: { date: "asc" },
    }),
    prisma.shiftRequest.findMany({ where: { companyId, status: "PENDING" }, include: { staff: true }, orderBy: { createdAt: "asc" } }),
    listPendingReportsForCompany(companyId),
    listPendingContractStaff(companyId),
  ]);

  return { shortageRecruitments, shiftRequests, pendingReports, pendingContractStaff };
}

export type DashboardData = Awaited<ReturnType<typeof loadDashboardData>>;
type PendingShipment = { id: string; promoItem: { name: string }; staff: { name: string } };

export function computeKpis(
  data: DashboardData,
  promoItemCount: number,
  pendingShipmentCount: number,
) {
  const shortageCount = data.shortageRecruitments.filter(
    (r) => r.entries.filter((e) => e.status !== "REJECTED").length < r.maxEntries,
  ).length;

  return {
    shortageCount,
    unconfirmedShiftCount: data.shiftRequests.length,
    pendingReportCount: data.pendingReports.length,
    pendingContractCount: data.pendingContractStaff.length,
    promoItemCount,
    pendingShipmentCount,
  };
}

export function computeShortageEntries(data: DashboardData) {
  return data.shortageRecruitments
    .map((r) => ({
      id: r.id,
      title: r.title,
      date: r.date.toISOString().slice(0, 10),
      startTime: r.startTime,
      endTime: r.endTime,
      filled: r.entries.filter((e) => e.status !== "REJECTED").length,
      maxEntries: r.maxEntries,
    }))
    .filter((r) => r.filled < r.maxEntries);
}

export function computeUnconfirmedShiftEntries(data: DashboardData) {
  return data.shiftRequests.map((r) => ({
    id: r.id,
    staffName: r.staff.name,
    desire: r.desire,
    dates: r.dates.map((d) => d.toISOString().slice(0, 10)),
    note: r.note,
  }));
}

const REPORT_OUTCOME_LABEL: Record<string, string> = {
  WORKED: "出勤した",
  ABSENT: "欠勤",
  CANCELLED_BY_EMPLOYER: "勤務先からのキャンセル",
};

function formatJstTime(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(date);
}

export function computePendingReportEntries(data: DashboardData) {
  return data.pendingReports.map((r) => ({
    id: r.id,
    staffName: r.staff.name,
    teamName: r.shift.team?.name ?? null,
    date: r.shift.date.toISOString().slice(0, 10),
    startTime: r.shift.startTime,
    endTime: r.shift.endTime,
    outcome: REPORT_OUTCOME_LABEL[r.outcome] ?? r.outcome,
    clockIn: r.clockIn ? formatJstTime(r.clockIn) : null,
    clockOut: r.clockOut ? formatJstTime(r.clockOut) : null,
    breakMinutes: r.breakMinutes,
    computedHours: (r.computedMinutes / 60).toFixed(2),
    comment: r.comment,
    taskName: r.taskName ?? r.shift.taskName,
  }));
}

export type AutoTodoItem = {
  id: string;
  kind: "業務報告" | "欠員" | "シフト" | "契約書" | "販促品";
  text: string;
  actionLabel: string;
  actionHref: string;
};

// Auto-generated to-do rows are derived live from the same queues shown
// elsewhere (work-report approvals, shift requests, recruitment shortfall,
// pending shipments) rather than materialized by a background job — see
// loadDashboardData for why they're fetched once and shared. Contract items
// are staff with no live StaffContract yet (see listPendingContractStaff) —
// the 契約を結ぶ flow is self-service and immediate (see startStaffContract),
// so there is no separate 確認待ち state.
export function computeAutoTodoItems(data: DashboardData, pendingShipments: PendingShipment[]): AutoTodoItem[] {
  const { shortageRecruitments, shiftRequests, pendingReports, pendingContractStaff } = data;
  const items: AutoTodoItem[] = [];

  for (const r of shortageRecruitments) {
    const filled = r.entries.filter((e) => e.status !== "REJECTED").length;
    if (filled < r.maxEntries) {
      const dateStr = r.date.toISOString().slice(0, 10);
      items.push({
        id: `shortage-${r.id}`,
        kind: "欠員",
        text: `${r.title}（${dateStr}）が${r.maxEntries - filled}名不足しています`,
        actionLabel: "カレンダーで確認",
        actionHref: `/company/calendar?date=${dateStr}`,
      });
    }
  }

  for (const sr of shiftRequests) {
    const dateStr = sr.dates[0]?.toISOString().slice(0, 10) ?? "";
    items.push({
      id: `shift-${sr.id}`,
      kind: "シフト",
      text: `${sr.staff.name}さんの希望シフト（${dateStr}）が未確定です`,
      actionLabel: "カレンダーで確認",
      actionHref: dateStr ? `/company/calendar?date=${dateStr}` : "/company/calendar",
    });
  }

  for (const report of pendingReports) {
    const teamName = report.shift.team?.name ?? "自社";
    const dateStr = report.shift.date.toISOString().slice(0, 10);
    const timeRange =
      report.shift.startTime && report.shift.endTime ? `・${report.shift.startTime}〜${report.shift.endTime}` : "";
    items.push({
      id: `report-${report.id}`,
      kind: "業務報告",
      text: `${report.staff.name}さんの業務（${teamName}）（${dateStr}${timeRange}）業務報告が未承認です`,
      actionLabel: "確認する",
      actionHref: `/company?open=reports&reportId=${report.id}`,
    });
  }

  for (const staff of pendingContractStaff) {
    items.push({
      id: `contract-${staff.userId}`,
      kind: "契約書",
      text: `${staff.name}さんの契約書が未送付です`,
      actionLabel: "確認する",
      actionHref: "/company?open=contracts",
    });
  }

  for (const redemption of pendingShipments) {
    items.push({
      id: `promo-${redemption.id}`,
      kind: "販促品",
      text: `発送待ち：${redemption.promoItem.name}の注文があります（${redemption.staff.name}さん）`,
      actionLabel: "確認する",
      actionHref: "/company?open=promoOrders",
    });
  }

  return items;
}

export async function listManualTodos(companyId: string, status: "OPEN" | "RESOLVED") {
  return prisma.todoItem.findMany({
    where: { companyId, kind: "MANUAL", status },
    include: { recipient: true, createdBy: true, comments: { include: { author: true }, orderBy: { createdAt: "asc" } } },
    orderBy: status === "OPEN" ? { dueDate: "asc" } : { resolvedAt: "desc" },
  });
}

export async function createManualTodo(params: {
  companyId: string;
  teamId?: string;
  title: string;
  dueDate: Date;
  recipientUserId: string;
  createdByUserId: string;
  imageUrl?: string;
}) {
  // 誰宛か is restricted to same-company/same-team members — enforced by the
  // caller resolving recipientUserId from the company's own roster/team list.
  return prisma.todoItem.create({
    data: {
      companyId: params.companyId,
      teamId: params.teamId,
      kind: "MANUAL",
      title: params.title,
      dueDate: params.dueDate,
      recipientUserId: params.recipientUserId,
      createdByUserId: params.createdByUserId,
      imageUrl: params.imageUrl,
    },
  });
}

export async function resolveTodo(id: string) {
  return prisma.todoItem.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
}

export async function reopenTodo(id: string) {
  return prisma.todoItem.update({ where: { id }, data: { status: "OPEN", resolvedAt: null } });
}

export async function addTodoComment(params: { todoItemId: string; authorUserId: string; body: string }) {
  return prisma.todoComment.create({
    data: { todoItemId: params.todoItemId, authorUserId: params.authorUserId, body: params.body },
  });
}
