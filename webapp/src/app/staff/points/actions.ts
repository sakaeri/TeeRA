"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyStaffRole } from "@/lib/auth/session";
import { redeemPromoItem } from "@/lib/domain/promo";

export async function redeemPromoItemAction(promoItemId: string, shippingAddress: string, shippingPhone: string) {
  const { userId } = await requireCompanyStaffRole();

  try {
    await redeemPromoItem({ promoItemId, staffUserId: userId, shippingAddress, shippingPhone });
  } catch (error) {
    // 失敗時（在庫切れ等）もrevalidateする — しないと、失敗の原因になった
    // 最新の在庫/ポイント残高がページに反映されないまま残り、次にモーダル
    // を開いた時も古い（交換できるように見える）表示のままになる。
    revalidatePath("/staff/points");
    return { error: error instanceof Error ? error.message : "unknown" };
  }
  revalidatePath("/staff/points");
  return { error: null };
}
