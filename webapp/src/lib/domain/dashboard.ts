import "server-only";
import { prisma } from "@/lib/prisma";
import { listPendingReportsForCompany } from "@/lib/domain/workReports";

// KPI counts are computed live from current state rather than materialized
// via a background job — the "未確定シフト" list, recruitment fill counts,
// and pending queues are already the source of truth elsewhere in the app,
// so re-deriving them here keeps the dashboard always consistent with them.
export async function getKpis(companyId: string) {
  const [shortageRecruitments, unconfirmedShiftCount, pendingReports, pendingContractCount, promoItemCount, pendingShipmentCount] =
    await Promise.all([
      prisma.publicRecruitment.findMany({
        where: { companyId, status: "PUBLISHED" },
        include: { entries: true },
      }),
      prisma.shiftRequest.count({ where: { companyId, status: "PENDING" } }),
      listPendingReportsForCompany(companyId),
      prisma.staffContract.count({
        where: { status: "PENDING_CONSENT", template: { companyId } },
      }),
      prisma.promoItem.count({ where: { companyId } }),
      prisma.promoRedemption.count({
        where: { status: "PENDING_SHIPMENT", promoItem: { companyId } },
      }),
    ]);

  const shortageCount = shortageRecruitments.filter(
    (r) => r.entries.filter((e) => e.status !== "REJECTED").length < r.maxEntries,
  ).length;

  return {
    shortageCount,
    unconfirmedShiftCount,
    pendingReportCount: pendingReports.length,
    pendingContractCount,
    promoItemCount,
    pendingShipmentCount,
  };
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
// getKpis for why. Contract items use StaffContract.PENDING_CONSENT, which
// this build's simplified 契約を結ぶ flow never actually leaves in that
// state (see startStaffContract), so this list is empty for that kind in v1.
export async function listAutoTodoItems(companyId: string): Promise<AutoTodoItem[]> {
  const [shortageRecruitments, shiftRequests, pendingReports, pendingContracts, pendingShipments] =
    await Promise.all([
      prisma.publicRecruitment.findMany({
        where: { companyId, status: "PUBLISHED" },
        include: { entries: true },
      }),
      prisma.shiftRequest.findMany({ where: { companyId, status: "PENDING" }, include: { staff: true } }),
      listPendingReportsForCompany(companyId),
      prisma.staffContract.findMany({
        where: { status: "PENDING_CONSENT", template: { companyId } },
        include: { staff: true },
      }),
      prisma.promoRedemption.findMany({
        where: { status: "PENDING_SHIPMENT", promoItem: { companyId } },
        include: { promoItem: true, staff: true },
      }),
    ]);

  const items: AutoTodoItem[] = [];

  for (const r of shortageRecruitments) {
    const filled = r.entries.filter((e) => e.status !== "REJECTED").length;
    if (filled < r.maxEntries) {
      items.push({
        id: `shortage-${r.id}`,
        kind: "欠員",
        text: `${r.title}（${r.date.toISOString().slice(0, 10)}）が${r.maxEntries - filled}名不足しています`,
        actionLabel: "カレンダーで確認",
        actionHref: "/company/calendar",
      });
    }
  }

  for (const sr of shiftRequests) {
    items.push({
      id: `shift-${sr.id}`,
      kind: "シフト",
      text: `${sr.staff.name}さんの希望シフト（${sr.dates[0]?.toISOString().slice(0, 10) ?? ""}）が未確定です`,
      actionLabel: "カレンダーで確認",
      actionHref: "/company/calendar",
    });
  }

  for (const report of pendingReports) {
    items.push({
      id: `report-${report.id}`,
      kind: "業務報告",
      text: `${report.staff.name}さんの業務報告が未承認です`,
      actionLabel: "確認する",
      actionHref: "/company/settings?tab=workreports",
    });
  }

  for (const contract of pendingContracts) {
    items.push({
      id: `contract-${contract.id}`,
      kind: "契約書",
      text: `${contract.staff.name}さんの契約書が未締結です`,
      actionLabel: "確認する",
      actionHref: "/company/settings?tab=contracts",
    });
  }

  for (const redemption of pendingShipments) {
    items.push({
      id: `promo-${redemption.id}`,
      kind: "販促品",
      text: `発送待ち：${redemption.promoItem.name}の注文があります（${redemption.staff.name}さん）`,
      actionLabel: "確認する",
      actionHref: "/company",
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
