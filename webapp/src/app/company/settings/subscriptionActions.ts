"use server";

import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManageCompanySettings } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";
import {
  createSubscriptionCheckoutSession,
  schedulePlanCancellation,
  undoPlanCancellation,
  PlanCancelError,
} from "@/lib/domain/subscriptions";
import { PLAN_YEN, type PaidPlanTier } from "@/lib/domain/plans";

// wallet/actions.tsのcreateCheckoutSessionActionと同じ理由で、Stripe呼び出し
// 部分は必ず捕まえてエラーを構造化データとして返す。
export async function createSubscriptionCheckoutSessionAction(planTier: PaidPlanTier) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");
  if (!(planTier in PLAN_YEN)) throw new Error("invalid_plan");

  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  try {
    const session = await createSubscriptionCheckoutSession({
      companyId: membership.companyId,
      planTier,
      returnUrl: `${base}/company/wallet?checkout=return`,
      createdByUserId: userId,
    });
    return { clientSecret: session.client_secret, error: null };
  } catch (error) {
    console.error("createSubscriptionCheckoutSession failed", error);
    return { clientSecret: null, error: "決済の準備に失敗しました。時間を置いてもう一度お試しください。" };
  }
}

// 無料プランに戻す（今の期間の終わりに解約する予約）／その取り消し
export async function setPlanCancellationAction(cancel: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");
  try {
    if (cancel) await schedulePlanCancellation(membership.companyId, userId);
    else await undoPlanCancellation(membership.companyId, userId);
  } catch (error) {
    if (error instanceof PlanCancelError) return { ok: false, message: error.message };
    console.error("setPlanCancellation failed", error);
    return { ok: false, message: "手続きに失敗しました。時間を置いてもう一度お試しください。" };
  }
  revalidatePath("/company/wallet");
  return { ok: true };
}
