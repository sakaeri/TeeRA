import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import {
  getKpis,
  listManualTodos,
  listAutoTodoItems,
  listShortageEntries,
  listUnconfirmedShiftEntries,
  listPendingReportEntries,
  listPendingContractStaff,
} from "@/lib/domain/dashboard";
import { listPromoItems, listRedemptionsForCompany } from "@/lib/domain/promo";
import { listTemplates } from "@/lib/domain/contracts";
import { listClients } from "@/lib/domain/relationships";
import { prisma } from "@/lib/prisma";
import { DashboardView } from "@/components/company/DashboardView";

export default async function CompanyDashboardPage() {
  const { userId, membership } = await requireCompanyAdminOrEditor();

  const [
    kpis,
    autoTodos,
    openTodos,
    resolvedTodos,
    admins,
    promoItems,
    redemptions,
    shortageEntries,
    unconfirmedShiftEntries,
    pendingReportEntries,
    pendingContractStaff,
    templates,
    company,
  ] = await Promise.all([
    getKpis(membership.companyId),
    listAutoTodoItems(membership.companyId),
    listManualTodos(membership.companyId, "OPEN"),
    listManualTodos(membership.companyId, "RESOLVED"),
    prisma.companyMembership.findMany({
      where: { companyId: membership.companyId, role: { in: ["COMPANY_ADMIN", "COMPANY_EDITOR"] } },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    listPromoItems(membership.companyId),
    listRedemptionsForCompany(membership.companyId),
    listShortageEntries(membership.companyId),
    listUnconfirmedShiftEntries(membership.companyId),
    listPendingReportEntries(membership.companyId),
    listPendingContractStaff(membership.companyId),
    listTemplates(membership.companyId),
    prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } }),
  ]);

  const clients = company.agencyEnabled ? await listClients(membership.companyId) : [];

  const currentUserName = admins.find((a) => a.userId === userId)?.user.name ?? "";

  return (
    <main className="mx-auto w-full max-w-5xl px-8 py-10">
      <DashboardView
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
        companyName={company.name}
        contractClients={clients.map((c) => ({
          id: c.id,
          name: c.clientCompany?.name ?? c.proxyName ?? "(名称未設定)",
        }))}
        contractTemplates={templates
          .filter((t) => t.status === "ACTIVE")
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
      />
    </main>
  );
}
