import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { listPromoItems, listRedemptionsForCompany } from "@/lib/domain/promo";
import { PromoManageView } from "@/components/company/PromoManageView";

export default async function PromoPage() {
  const { membership } = await requireCompanyAdminOrEditor();
  const [items, redemptions] = await Promise.all([
    listPromoItems(membership.companyId),
    listRedemptionsForCompany(membership.companyId),
  ]);

  return (
    <main className="mx-auto w-full max-w-4xl px-8 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">販促品</h1>
      <PromoManageView
        items={items.map((i) => ({
          id: i.id,
          imageUrl: i.imageUrl,
          name: i.name,
          pointsCost: i.pointsCost,
          stock: i.stock,
          description: i.description,
        }))}
        redemptions={redemptions.map((r) => ({
          id: r.id,
          itemName: r.promoItem.name,
          staffName: r.staff.name,
          pointsSpent: r.pointsSpent,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </main>
  );
}
