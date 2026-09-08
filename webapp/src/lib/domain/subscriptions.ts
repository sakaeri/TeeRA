import "server-only";
import { prisma } from "@/lib/prisma";
import { requireStripe } from "@/lib/stripe";
import { PLAN_YEN } from "@/lib/domain/plans";
import type { PlanTier } from "@/generated/prisma/enums";

export async function createSubscriptionCheckoutSession(params: {
  companyId: string;
  planTier: "STANDARD" | "BUSINESS";
  successUrl: string;
  cancelUrl: string;
}) {
  const stripe = requireStripe();
  const yenAmount = PLAN_YEN[params.planTier];

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "jpy",
          unit_amount: yenAmount,
          recurring: { interval: "month" },
          product_data: { name: `TeeRA ${params.planTier === "STANDARD" ? "スタンダード" : "ビジネス"}プラン` },
        },
        quantity: 1,
      },
    ],
    metadata: { companyId: params.companyId, planTier: params.planTier },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });

  await prisma.stripeSubscription.create({
    data: {
      companyId: params.companyId,
      stripeCheckoutSessionId: session.id,
      planTier: params.planTier,
      status: "PENDING",
    },
  });

  return session;
}

// Called from the Stripe webhook once checkout completes. Idempotent: a
// subscription row already ACTIVE is left untouched even if Stripe retries
// the webhook delivery (mirrors confirmStripeCharge's idempotency).
export async function confirmSubscriptionCheckout(sessionId: string, stripeSubscriptionId: string | null) {
  const sub = await prisma.stripeSubscription.findUnique({ where: { stripeCheckoutSessionId: sessionId } });
  if (!sub || sub.status !== "PENDING") return;

  await prisma.$transaction(async (tx) => {
    await tx.stripeSubscription.update({
      where: { id: sub.id },
      data: { status: "ACTIVE", stripeSubscriptionId },
    });
    await tx.company.update({ where: { id: sub.companyId }, data: { planTier: sub.planTier } });
  });
}

export async function markSubscriptionCheckoutFailed(sessionId: string) {
  await prisma.stripeSubscription.updateMany({
    where: { stripeCheckoutSessionId: sessionId, status: "PENDING" },
    data: { status: "CANCELED" },
  });
}

// 解約/支払い失敗イベント（customer.subscription.deleted / customer.subscription.updated
// でstatusがcanceled/past_due等になった場合）— 会社を無料プランへ戻す。
// グランドファザリングはしない（ユーザー確認済み — その場ですぐ3ヶ月制限に戻る）。
export async function handleSubscriptionLifecycleEvent(stripeSubscriptionId: string, newStatus: "ACTIVE" | "PAST_DUE" | "CANCELED") {
  const sub = await prisma.stripeSubscription.findUnique({ where: { stripeSubscriptionId } });
  if (!sub) return;

  await prisma.$transaction(async (tx) => {
    await tx.stripeSubscription.update({ where: { id: sub.id }, data: { status: newStatus } });
    if (newStatus === "PAST_DUE" || newStatus === "CANCELED") {
      await tx.company.update({ where: { id: sub.companyId }, data: { planTier: "FREE" as PlanTier } });
    } else {
      await tx.company.update({ where: { id: sub.companyId }, data: { planTier: sub.planTier } });
    }
  });
}
