import "server-only";
import { prisma } from "@/lib/prisma";
import { requireStripe, teeYenPerUnit } from "@/lib/stripe";
import { postLedgerEntry } from "@/lib/domain/wallet";

export async function createStripeCheckoutSession(params: {
  companyId: string;
  teeAmount: number;
  successUrl: string;
  cancelUrl: string;
}) {
  const stripe = requireStripe();
  const yenAmount = params.teeAmount * teeYenPerUnit();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "jpy",
          unit_amount: yenAmount,
          product_data: { name: `TeeRA Tee ${params.teeAmount}枚` },
        },
        quantity: 1,
      },
    ],
    metadata: { companyId: params.companyId, teeAmount: String(params.teeAmount) },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });

  await prisma.stripeCharge.create({
    data: {
      companyId: params.companyId,
      stripePaymentIntentId: session.id,
      yenAmount,
      teeAmount: params.teeAmount,
      status: "PENDING",
    },
  });

  return session;
}

// Called from the Stripe webhook once payment is confirmed. Idempotent: a
// charge already marked SUCCEEDED is left untouched even if Stripe retries
// the webhook delivery.
export async function confirmStripeCharge(stripeSessionId: string) {
  const charge = await prisma.stripeCharge.findUnique({ where: { stripePaymentIntentId: stripeSessionId } });
  if (!charge || charge.status !== "PENDING") return;

  await prisma.$transaction(async (tx) => {
    await tx.stripeCharge.update({ where: { id: charge.id }, data: { status: "SUCCEEDED" } });
    await postLedgerEntry(tx, {
      companyId: charge.companyId,
      type: "CHARGE_CARD",
      amount: charge.teeAmount,
      stripeChargeId: charge.id,
    });
  });
}

export async function markStripeChargeFailed(stripeSessionId: string) {
  await prisma.stripeCharge.updateMany({
    where: { stripePaymentIntentId: stripeSessionId, status: "PENDING" },
    data: { status: "FAILED" },
  });
}

// 銀行振込: request stays PENDING (no Tee credited) until confirmed. In a
// full production build, confirmation would be reconciled against real bank
// statements by TeeRA's own back office — this prototype-derived build
// exposes it as an explicit company-admin action instead, matching how the
// original design simplified it (no separate platform-ops role exists yet).
export async function createBankTransferRequest(params: { companyId: string; teeAmount: number }) {
  return prisma.bankTransferRequest.create({
    data: {
      companyId: params.companyId,
      teeAmount: params.teeAmount,
      yenAmount: params.teeAmount * teeYenPerUnit(),
    },
  });
}

export async function confirmBankTransferRequest(params: { bankTransferRequestId: string; confirmedByUserId: string }) {
  const request = await prisma.bankTransferRequest.findUniqueOrThrow({
    where: { id: params.bankTransferRequestId },
  });
  if (request.status !== "PENDING") throw new Error("not_pending");

  return prisma.$transaction(async (tx) => {
    await tx.bankTransferRequest.update({
      where: { id: request.id },
      data: { status: "CONFIRMED", confirmedByUserId: params.confirmedByUserId, confirmedAt: new Date() },
    });
    return postLedgerEntry(tx, {
      companyId: request.companyId,
      type: "CHARGE_BANK_CONFIRMED",
      amount: request.teeAmount,
      bankTransferRequestId: request.id,
      createdByUserId: params.confirmedByUserId,
    });
  });
}

export async function cancelBankTransferRequest(bankTransferRequestId: string) {
  return prisma.bankTransferRequest.update({
    where: { id: bankTransferRequestId },
    data: { status: "CANCELLED" },
  });
}

export async function listWalletHistory(companyId: string) {
  const [ledgerEntries, bankTransfers] = await Promise.all([
    prisma.teeLedgerEntry.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.bankTransferRequest.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return { ledgerEntries, bankTransfers };
}
