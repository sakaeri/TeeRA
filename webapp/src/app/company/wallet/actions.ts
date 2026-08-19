"use server";

import { redirect } from "next/navigation";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManageCompanySettings } from "@/lib/auth/permissions";
import { createStripeCheckoutSession } from "@/lib/domain/teeWallet";

export async function createCheckoutSessionAction(teeAmount: number) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const session = await createStripeCheckoutSession({
    companyId: membership.companyId,
    teeAmount,
    successUrl: `${base}/company/wallet?checkout=success`,
    cancelUrl: `${base}/company/wallet?checkout=cancelled`,
  });

  redirect(session.url ?? `${base}/company/wallet`);
}
