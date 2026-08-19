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

export async function listWalletHistory(companyId: string) {
  return prisma.teeLedgerEntry.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 100 });
}
