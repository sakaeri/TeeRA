"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManage } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { createPromoItem, updatePromoItem, deletePromoItem, markRedemptionShipped } from "@/lib/domain/promo";

export async function createPromoItemAction(input: {
  imageUrl: string;
  name: string;
  pointsCost: number;
  stock: number;
  description?: string;
}) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  await createPromoItem({ ...input, companyId: membership.companyId });
  revalidatePath("/company");
}

export async function updatePromoItemAction(
  id: string,
  changes: Partial<{ imageUrl: string; name: string; pointsCost: number; stock: number; description: string }>,
) {
  const { membership } = await requireCompanyAdminOrEditor();
  const item = await prisma.promoItem.findUniqueOrThrow({ where: { id } });
  if (item.companyId !== membership.companyId || !canManage(membership)) throw new Error("forbidden");

  await updatePromoItem(id, changes);
  revalidatePath("/company");
}

export async function deletePromoItemAction(id: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  const item = await prisma.promoItem.findUniqueOrThrow({ where: { id } });
  if (item.companyId !== membership.companyId || !canManage(membership)) throw new Error("forbidden");

  await deletePromoItem(id);
  revalidatePath("/company");
}

export async function markRedemptionShippedAction(redemptionId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  const redemption = await prisma.promoRedemption.findUniqueOrThrow({
    where: { id: redemptionId },
    include: { promoItem: true },
  });
  if (redemption.promoItem.companyId !== membership.companyId || !canManage(membership)) {
    throw new Error("forbidden");
  }

  await markRedemptionShipped(redemptionId);
  revalidatePath("/company");
}
