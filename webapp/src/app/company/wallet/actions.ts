"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManageCompanySettings } from "@/lib/auth/permissions";
import {
  createStripeCheckoutSession,
  createBankTransferRequest,
  confirmBankTransferRequest,
  cancelBankTransferRequest,
} from "@/lib/domain/teeWallet";

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

export async function createBankTransferRequestAction(teeAmount: number) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  await createBankTransferRequest({ companyId: membership.companyId, teeAmount });
  revalidatePath("/company/wallet");
}

export async function confirmBankTransferRequestAction(bankTransferRequestId: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  await confirmBankTransferRequest({ bankTransferRequestId, confirmedByUserId: userId });
  revalidatePath("/company/wallet");
}

export async function cancelBankTransferRequestAction(bankTransferRequestId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  await cancelBankTransferRequest(bankTransferRequestId);
  revalidatePath("/company/wallet");
}
