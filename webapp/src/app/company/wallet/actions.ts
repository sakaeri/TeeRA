"use server";

import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManageCompanySettings } from "@/lib/auth/permissions";
import { createStripeCheckoutSession } from "@/lib/domain/teeWallet";

// Next.jsは本番ビルドでServer Actionから素通しで投げた例外のmessageを
// 握りつぶしてしまうため（calendar/actions.tsのopenRecruitmentToPublicAction
// と同じ理由）、Stripe呼び出し部分は必ず捕まえてエラーを構造化データとして返す。
export async function createCheckoutSessionAction(teeAmount: number) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  try {
    const session = await createStripeCheckoutSession({
      companyId: membership.companyId,
      teeAmount,
      returnUrl: `${base}/company/wallet?checkout=return`,
    });
    return { clientSecret: session.client_secret, error: null };
  } catch {
    return { clientSecret: null, error: "決済の準備に失敗しました。時間を置いてもう一度お試しください。" };
  }
}
