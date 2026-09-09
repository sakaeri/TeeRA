import "server-only";
import { prisma } from "@/lib/prisma";

export async function listPromoItems(companyId: string) {
  return prisma.promoItem.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } });
}

export async function createPromoItem(params: {
  companyId: string;
  imageUrl: string;
  name: string;
  pointsCost: number;
  stock: number;
  description?: string;
}) {
  return prisma.promoItem.create({ data: params });
}

export async function updatePromoItem(
  id: string,
  changes: Partial<{ imageUrl: string; name: string; pointsCost: number; stock: number; description: string }>,
) {
  return prisma.promoItem.update({ where: { id }, data: changes });
}

export async function deletePromoItem(id: string) {
  return prisma.promoItem.delete({ where: { id } });
}

export async function getStaffPointsBalance(staffUserId: string) {
  const latest = await prisma.staffPointsLedgerEntry.findFirst({
    where: { staffUserId },
    orderBy: { createdAt: "desc" },
  });
  return latest?.balanceAfter ?? 0;
}

// TeeRAメンバーのランク（ブロンズ/シルバー/ゴールド）— 承認済み業務報告の
// 累計件数のみで決まる。thresholdはそのランクの終わり（=次のランクの開始）。
const RANKS = [
  { name: "ブロンズ", rate: 1, start: 0, threshold: 300 },
  { name: "シルバー", rate: 2, start: 300, threshold: 600 },
  { name: "ゴールド", rate: 3, start: 600, threshold: null as number | null },
] as const;

// Tier progress toward the NEXT accrual rate (1pt for the 1st-300th approved
// WORKED report, 2pt for 301st-600th, 3pt for 601st+ — permission-rules-memo
// item ④). This tracks report count, not point balance.
export async function getStaffTierProgress(staffUserId: string) {
  const approvedCount = await prisma.workReport.count({
    where: { staffUserId, outcome: "WORKED", approvalStatus: "APPROVED" },
  });

  const rankIndex = approvedCount < 300 ? 0 : approvedCount < 600 ? 1 : 2;
  const rank = RANKS[rankIndex];
  const nextRank = RANKS[rankIndex + 1] ?? null;

  return {
    approvedCount,
    rankName: rank.name,
    rankLevel: rankIndex + 1,
    currentRate: rank.rate,
    tierStart: rank.start,
    tierThreshold: rank.threshold,
    nextRankName: nextRank?.name ?? null,
  };
}

export async function redeemPromoItem(params: {
  promoItemId: string;
  staffUserId: string;
  shippingAddress: string;
  shippingPhone: string;
}) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.promoItem.findUniqueOrThrow({ where: { id: params.promoItemId } });
    if (item.stock <= 0) throw new Error("out_of_stock");

    const latest = await tx.staffPointsLedgerEntry.findFirst({
      where: { staffUserId: params.staffUserId },
      orderBy: { createdAt: "desc" },
    });
    const balance = latest?.balanceAfter ?? 0;
    if (balance < item.pointsCost) throw new Error("insufficient_points");

    await tx.promoItem.update({ where: { id: item.id }, data: { stock: item.stock - 1 } });

    // Remember the address for next time, and snapshot it onto this order so a
    // later change doesn't retroactively alter an already-placed order.
    await tx.user.update({
      where: { id: params.staffUserId },
      data: { address: params.shippingAddress, phoneNumber: params.shippingPhone },
    });

    const redemption = await tx.promoRedemption.create({
      data: {
        promoItemId: item.id,
        staffUserId: params.staffUserId,
        pointsSpent: item.pointsCost,
        shippingAddress: params.shippingAddress,
        shippingPhone: params.shippingPhone,
      },
    });

    await tx.staffPointsLedgerEntry.create({
      data: {
        staffUserId: params.staffUserId,
        type: "REDEEM_PROMO",
        points: -item.pointsCost,
        balanceAfter: balance - item.pointsCost,
        relatedRedemptionId: redemption.id,
      },
    });

    return redemption;
  });
}

export async function markRedemptionShipped(redemptionId: string) {
  return prisma.promoRedemption.update({
    where: { id: redemptionId },
    data: { status: "SHIPPED", shippedAt: new Date() },
  });
}

export async function listRedemptionsForCompany(companyId: string) {
  return prisma.promoRedemption.findMany({
    where: { promoItem: { companyId } },
    include: { promoItem: true, staff: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function listRedemptionsForStaff(staffUserId: string) {
  return prisma.promoRedemption.findMany({
    where: { staffUserId },
    include: { promoItem: true },
    orderBy: { createdAt: "desc" },
  });
}
