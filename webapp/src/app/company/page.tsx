import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import {
  loadDashboardData,
  computeKpis,
  computeAutoTodoItems,
  computeShortageEntries,
  computeUnconfirmedShiftEntries,
  computePendingReportEntries,
  listManualTodos,
} from "@/lib/domain/dashboard";
import { listPromoItems, listRedemptionsForCompany } from "@/lib/domain/promo";
import { listTemplates } from "@/lib/domain/contracts";
import { listClients } from "@/lib/domain/relationships";
import { prisma } from "@/lib/prisma";
import { DashboardView } from "@/components/company/DashboardView";

export default async function CompanyDashboardPage({ searchParams }: PageProps<"/company">) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const sp = await searchParams;
  const open = typeof sp.open === "string" ? sp.open : undefined;
  const reportId = typeof sp.reportId === "string" ? sp.reportId : undefined;

  const [
    dashboardData,
    openTodos,
    resolvedTodos,
    admins,
    promoItems,
    redemptions,
    templates,
    company,
  ] = await Promise.all([
    loadDashboardData(membership.companyId),
    listManualTodos(membership.companyId, "OPEN"),
    listManualTodos(membership.companyId, "RESOLVED"),
    prisma.companyMembership.findMany({
      where: { companyId: membership.companyId, role: { in: ["COMPANY_ADMIN", "COMPANY_EDITOR"] } },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    listPromoItems(membership.companyId),
    listRedemptionsForCompany(membership.companyId),
    listTemplates(membership.companyId),
    prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } }),
  ]);

  const clients = company.agencyEnabled ? await listClients(membership.companyId) : [];

  // derived from the redemptions/promoItems already fetched above instead of
  // running their own separate COUNT/findMany queries for the same rows
  const pendingShipments = redemptions.filter((r) => r.status === "PENDING_SHIPMENT");
  const kpis = computeKpis(dashboardData, promoItems.length, pendingShipments.length);
  const autoTodos = computeAutoTodoItems(dashboardData, pendingShipments);
  const shortageEntries = computeShortageEntries(dashboardData);
  const unconfirmedShiftEntries = computeUnconfirmedShiftEntries(dashboardData);
  const pendingReportEntries = computePendingReportEntries(dashboardData);
  const pendingContractStaff = dashboardData.pendingContractStaff;
  const expiringContractStaff = dashboardData.expiringContractStaff;

  const currentUserName = admins.find((a) => a.userId === userId)?.user.name ?? "";
  const initialTab = open === "promoOrders" ? ("promoOrders" as const) : undefined;
  const initialOpenPopup =
    open === "contracts" ? ("contracts" as const) : open === "expiring" ? ("expiring" as const) : undefined;
  const initialReportDetailId = open === "reports" ? reportId : undefined;

  return (
    <main className="mx-auto w-full max-w-5xl px-8 py-10">
      <DashboardView
        key={`${open ?? "default"}-${reportId ?? ""}`}
        kpis={kpis}
        autoTodos={autoTodos}
        openTodos={openTodos.map((t) => ({
          id: t.id,
          title: t.title,
          dueDate: t.dueDate?.toISOString().slice(0, 10) ?? "",
          recipientName: t.recipient?.name ?? "",
          comments: t.comments.map((c) => ({ id: c.id, authorName: c.author.name, body: c.body })),
        }))}
        resolvedTodos={resolvedTodos.map((t) => ({
          id: t.id,
          title: t.title,
          dueDate: t.dueDate?.toISOString().slice(0, 10) ?? "",
          createdByName: t.createdBy?.name ?? "",
          recipientName: t.recipient?.name ?? "",
          resolvedAt: t.resolvedAt?.toISOString().slice(0, 10) ?? "",
          comments: t.comments.map((c) => ({ id: c.id, authorName: c.author.name, body: c.body })),
        }))}
        currentUserName={currentUserName}
        recipientOptions={admins.map((a) => ({ id: a.userId, name: a.user.name }))}
        promoItems={promoItems.map((p) => ({
          id: p.id,
          imageUrl: p.imageUrl,
          name: p.name,
          pointsCost: p.pointsCost,
          stock: p.stock,
          description: p.description,
        }))}
        promoOrders={redemptions.map((r) => ({
          id: r.id,
          itemName: r.promoItem.name,
          staffName: r.staff.name,
          status: r.status,
          createdAt: r.createdAt.toISOString().slice(0, 10),
          shippingAddress: r.shippingAddress,
          shippingPhone: r.shippingPhone,
        }))}
        shortageEntries={shortageEntries}
        unconfirmedShiftEntries={unconfirmedShiftEntries}
        pendingReportEntries={pendingReportEntries}
        pendingContractStaff={pendingContractStaff}
        expiringContractStaff={expiringContractStaff}
        companyName={company.name}
        contractClients={clients.map((c) => ({
          id: c.id,
          name: c.clientCompany?.name ?? c.proxyName ?? "(名称未設定)",
        }))}
        contractTemplates={templates
          // LOCKED（既に誰か契約中）でも「そのまま契約する」で複数人に
          // 割り当てられるようにするため、ARCHIVED以外は選択肢に含める。
          .filter((t) => t.status !== "ARCHIVED")
          .map((t) => ({
            id: t.id,
            title: t.title,
            employmentType: t.employmentType,
            workplaceType: t.workplaceType,
            workplaceNote: t.workplaceNote,
            clientName: t.workplaceNote ?? t.companyRelationship?.clientCompany?.name ?? t.companyRelationship?.proxyName ?? null,
            jobDescription: t.jobDescription,
            scheduleType: t.scheduleType,
            workStartTime: t.workStartTime,
            workEndTime: t.workEndTime,
            actualWorkMinutes: t.actualWorkMinutes,
            breakMinutes: t.breakMinutes,
            hasOvertime: t.hasOvertime,
            overtimeNote: t.overtimeNote,
            fixedWeekdays: t.fixedWeekdays,
            shiftPatternNote: t.shiftPatternNote,
            restNote: t.restNote,
            wageType: t.wageType,
            wageAmount: t.wageAmount,
            paymentClosingDay: t.paymentClosingDay,
            paymentDay: t.paymentDay,
            paymentMethod: t.paymentMethod,
            contractPeriodType: t.contractPeriodType,
            contractStartDate: t.contractStartDate.toISOString().slice(0, 10),
            contractEndDate: t.contractEndDate ? t.contractEndDate.toISOString().slice(0, 10) : null,
            extraItems: (t.extraItems as { label: string; value: string }[] | null) ?? [],
            status: t.status,
            contractedStaffNames: t.staffContracts.filter((sc) => sc.status !== "ENDED").map((sc) => sc.staff.name),
          }))}
        initialTab={initialTab}
        initialOpenPopup={initialOpenPopup}
        initialReportDetailId={initialReportDetailId}
      />
    </main>
  );
}
