import { requireCompanyStaffRole } from "@/lib/auth/session";
import {
  listPromoItems,
  listRedemptionsForStaff,
  getStaffPointsBalance,
  getStaffTierProgress,
} from "@/lib/domain/promo";
import { StaffPointsView } from "@/components/staff/StaffPointsView";

export default async function StaffPointsPage() {
  const { userId, membership } = await requireCompanyStaffRole();

  const [items, redemptions, balance, tier] = await Promise.all([
    listPromoItems(membership.companyId),
    listRedemptionsForStaff(userId),
    getStaffPointsBalance(userId),
    getStaffTierProgress(userId),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">TeeRAメンバー</h1>
      <StaffPointsView
        balance={balance}
        tier={tier}
        items={items.map((i) => ({
          id: i.id,
          imageUrl: i.imageUrl,
          name: i.name,
          pointsCost: i.pointsCost,
          stock: i.stock,
          description: i.description,
        }))}
        orders={redemptions.map((r) => ({
          id: r.id,
          itemName: r.promoItem.name,
          pointsSpent: r.pointsSpent,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </main>
  );
}
