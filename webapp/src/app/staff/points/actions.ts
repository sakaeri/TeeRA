"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyStaffRole } from "@/lib/auth/session";
import { redeemPromoItem } from "@/lib/domain/promo";
import { notifyCompanyOfPromoOrder } from "@/lib/domain/emailNotifications";

export async function redeemPromoItemAction(promoItemId: string, shippingAddress: string, shippingPhone: string) {
  const { userId } = await requireCompanyStaffRole();

  try {
    const redemption = await redeemPromoItem({ promoItemId, staffUserId: userId, shippingAddress, shippingPhone });
    // 通知メールの失敗（Resend側の一時的な障害等）で、成立済みの注文自体が
    // 失敗したかのように利用者に見えてしまわないよう、ここだけ独立してcatchする。
    await notifyCompanyOfPromoOrder(redemption.id).catch((err) => console.error("[email] promo order notify failed", err));
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
