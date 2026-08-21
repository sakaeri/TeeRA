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
    contractTemplates,
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
    prisma.contractTemplate.findMany({
      where: { companyId: membership.companyId, status: "ACTIVE" },
      select: { id: true, title: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

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
        contractTemplates={contractTemplates}
      />
    </main>
  );
}
