"use server";

import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManageCompanySettings } from "@/lib/auth/permissions";
import { createSubscriptionCheckoutSession } from "@/lib/domain/subscriptions";

// wallet/actions.tsのcreateCheckoutSessionActionと同じ理由で、Stripe呼び出し
// 部分は必ず捕まえてエラーを構造化データとして返す。
export async function createSubscriptionCheckoutSessionAction(planTier: "STANDARD" | "BUSINESS") {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  try {
    const session = await createSubscriptionCheckoutSession({
      companyId: membership.companyId,
      planTier,
      returnUrl: `${base}/company/wallet?checkout=return`,
    });
    return { clientSecret: session.client_secret, error: null };
  } catch (error) {
    console.error("createSubscriptionCheckoutSession failed", error);
    return { clientSecret: null, error: "決済の準備に失敗しました。時間を置いてもう一度お試しください。" };
  }
}
