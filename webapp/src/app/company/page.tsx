import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { getKpis, listManualTodos, listAutoTodoItems } from "@/lib/domain/dashboard";
import { listStaff } from "@/lib/domain/roster";
import { listPromoItems, listRedemptionsForCompany } from "@/lib/domain/promo";
import { DashboardView } from "@/components/company/DashboardView";

export default async function CompanyDashboardPage() {
  const { membership } = await requireCompanyAdminOrEditor();

  const [kpis, autoTodos, openTodos, resolvedTodos, staff, promoItems, redemptions] = await Promise.all([
    getKpis(membership.companyId),
    listAutoTodoItems(membership.companyId),
    listManualTodos(membership.companyId, "OPEN"),
    listManualTodos(membership.companyId, "RESOLVED"),
    listStaff(membership.companyId),
    listPromoItems(membership.companyId),
    listRedemptionsForCompany(membership.companyId),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl px-8 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">ダッシュボード</h1>
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
          recipientName: t.recipient?.name ?? "",
          resolvedAt: t.resolvedAt?.toISOString().slice(0, 10) ?? "",
        }))}
        staffOptions={staff.map((s) => ({ id: s.userId, name: s.name }))}
        promoItems={promoItems.map((p) => ({ id: p.id, imageUrl: p.imageUrl, name: p.name, pointsCost: p.pointsCost, stock: p.stock }))}
        promoOrders={redemptions.map((r) => ({
          id: r.id,
          itemName: r.promoItem.name,
          staffName: r.staff.name,
          status: r.status,
          createdAt: r.createdAt.toISOString().slice(0, 10),
        }))}
      />
    </main>
  );
}
