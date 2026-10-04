import { requireCompanyStaffRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  listPromoItems,
  listRedemptionsForStaff,
  getStaffPointsBalance,
  getStaffTierProgress,
} from "@/lib/domain/promo";
import { StaffPointsView } from "@/components/staff/StaffPointsView";

export default async function StaffPointsPage() {
  const { userId, membership } = await requireCompanyStaffRole();

  const [items, redemptions, balance, tier, user] = await Promise.all([
    listPromoItems(membership.companyId),
    listRedemptionsForStaff(userId),
    getStaffPointsBalance(userId),
    getStaffTierProgress(userId),
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">TeeRAメンバー</h1>
      <StaffPointsView
        balance={balance}
        tier={tier}
        savedAddress={user.address ?? ""}
        savedPhone={user.phoneNumber ?? ""}
        savedRecipientName={user.shippingRecipientName ?? user.name ?? ""}
        savedPostalCode={user.postalCode ?? ""}
        items={items.map((i) => ({
          id: i.id,
          imageUrl: i.imageUrl,
          imageUrl2: i.imageUrl2,
          imageUrl3: i.imageUrl3,
          name: i.name,
          pointsCost: i.pointsCost,
          stock: i.stock,
          description: i.description,
        }))}
        orders={redemptions.map((r) => ({
          id: r.id,
          itemName: r.promoItem.name,
          itemImageUrl: r.promoItem.imageUrl,
          pointsSpent: r.pointsSpent,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
        }))}
        pendingOrders={Object.fromEntries(
          redemptions
            .filter((r) => r.status === "PENDING_SHIPMENT")
            .reduce((map, r) => {
              if (!map.has(r.promoItemId)) map.set(r.promoItemId, r.createdAt.toISOString());
              return map;
            }, new Map<string, string>()),
        )}
      />
    </main>
  );
}
