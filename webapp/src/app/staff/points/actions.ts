"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyStaffRole } from "@/lib/auth/session";
import { redeemPromoItem } from "@/lib/domain/promo";

export async function redeemPromoItemAction(promoItemId: string, shippingAddress: string, shippingPhone: string) {
  const { userId } = await requireCompanyStaffRole();

  try {
    await redeemPromoItem({ promoItemId, staffUserId: userId, shippingAddress, shippingPhone });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "unknown" };
  }
  revalidatePath("/staff/points");
  return { error: null };
}
