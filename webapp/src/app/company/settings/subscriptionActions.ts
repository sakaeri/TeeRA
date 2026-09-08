"use server";

import { redirect } from "next/navigation";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManageCompanySettings } from "@/lib/auth/permissions";
import { createSubscriptionCheckoutSession } from "@/lib/domain/subscriptions";

export async function createSubscriptionCheckoutSessionAction(planTier: "STANDARD" | "BUSINESS") {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const session = await createSubscriptionCheckoutSession({
    companyId: membership.companyId,
    planTier,
    successUrl: `${base}/company/settings?tab=basic&subscription=success`,
    cancelUrl: `${base}/company/settings?tab=basic&subscription=cancelled`,
  });

  redirect(session.url ?? `${base}/company/settings?tab=basic`);
}
