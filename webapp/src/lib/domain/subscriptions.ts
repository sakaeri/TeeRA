import "server-only";
import { prisma } from "@/lib/prisma";
import { requireStripe } from "@/lib/stripe";
import { PLAN_YEN, PLAN_LABEL, type PaidPlanTier } from "@/lib/domain/plans";
import type { PlanTier } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

export async function createSubscriptionCheckoutSession(params: {
  companyId: string;
  planTier: PaidPlanTier;
  returnUrl: string;
  createdByUserId: string;
}) {
  const stripe = requireStripe();
  const yenAmount = PLAN_YEN[params.planTier];

  // createStripeCheckoutSession（teeWallet.ts）と同じくembedded_pageモード
  // （checkout.stripe.comへ遷移させず自ページ内にフォームを埋め込む）。
  const session = await stripe.checkout.sessions.create({
    ui_mode: "embedded_page",
    redirect_on_completion: "if_required",
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "jpy",
          unit_amount: yenAmount,
          recurring: { interval: "month" },
          product_data: { name: `TeeRA ${PLAN_LABEL[params.planTier]}プラン` },
        },
        quantity: 1,
      },
    ],
    metadata: { companyId: params.companyId, planTier: params.planTier },
    return_url: params.returnUrl,
  });

  await prisma.stripeSubscription.create({
    data: {
      companyId: params.companyId,
      stripeCheckoutSessionId: session.id,
      planTier: params.planTier,
      status: "PENDING",
      createdByUserId: params.createdByUserId,
    },
  });

  return session;
}

// 会社のプランは「一番新しい有効な（ACTIVE）契約」で決める。無ければ無料。
// 以前は前の契約からの連絡（月の更新など）でプランが書き戻されていたため、どの契約の
// 連絡が来ても、必ずここで計算し直す。変わったら履歴（PlanChangeEvent）に残す。
async function recomputeCompanyPlan(tx: Tx, companyId: string, reason: string, byUserId: string | null) {
  const [company, current] = await Promise.all([
    tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { planTier: true } }),
    tx.stripeSubscription.findFirst({ where: { companyId, status: "ACTIVE" }, orderBy: { createdAt: "desc" } }),
  ]);
  const next: PlanTier = current?.planTier ?? "FREE";
  if (next === company.planTier) return;
  await tx.company.update({ where: { id: companyId }, data: { planTier: next } });
  await tx.planChangeEvent.create({ data: { companyId, fromTier: company.planTier, toTier: next, reason, byUserId } });
}

// Called from the Stripe webhook once checkout completes. Idempotent: a
// subscription row already ACTIVE is left untouched even if Stripe retries
// the webhook delivery (mirrors confirmStripeCharge's idempotency).
// プランの変更（2つ目以降の契約）なら、前の契約はStripe上でも解約する（二重請求を防ぐ）。
export async function confirmSubscriptionCheckout(sessionId: string, stripeSubscriptionId: string | null) {
  const sub = await prisma.stripeSubscription.findUnique({ where: { stripeCheckoutSessionId: sessionId } });
  if (!sub || sub.status !== "PENDING") return;

  await prisma.$transaction(async (tx) => {
    await tx.stripeSubscription.update({
      where: { id: sub.id },
      data: { status: "ACTIVE", stripeSubscriptionId },
    });
    await recomputeCompanyPlan(tx, sub.companyId, "CHANGED", sub.createdByUserId);
  });

  await cancelPreviousSubscriptions(sub.companyId, sub.id);
}

// 新しい契約より前の、まだ有効な契約を解約する。Stripeの解約が失敗しても、プランは一番新しい
// 契約で決まるので表示は正しいまま（失敗はログに残し、次の連絡で再度計算し直される）。
async function cancelPreviousSubscriptions(companyId: string, keepId: string) {
  const previous = await prisma.stripeSubscription.findMany({
    where: { companyId, id: { not: keepId }, status: { in: ["ACTIVE", "PAST_DUE"] } },
  });
  for (const old of previous) {
    try {
      if (old.stripeSubscriptionId) {
        // 残り期間分は日割りで清算する（Stripeの顧客残高に返る）
        await requireStripe().subscriptions.cancel(old.stripeSubscriptionId, { prorate: true });
      }
      await prisma.stripeSubscription.update({ where: { id: old.id }, data: { status: "CANCELED" } });
    } catch (error) {
      console.error(`[subscription] 前の契約の解約に失敗しました id=${old.id}`, error);
    }
  }
}

export async function markSubscriptionCheckoutFailed(sessionId: string) {
  await prisma.stripeSubscription.updateMany({
    where: { stripeCheckoutSessionId: sessionId, status: "PENDING" },
    data: { status: "CANCELED" },
  });
}

// 解約/支払い失敗イベント（customer.subscription.deleted / customer.subscription.updated）。
// その契約の状態を更新してから、会社のプランを「一番新しい有効な契約」で計算し直す
// （有効な契約が無くなれば無料プランへ。グランドファザリングはしない — その場ですぐ3ヶ月制限に戻る）。
// プラン変更で解約した前の契約の連絡が来ても、新しい契約が有効ならプランは変わらない。
export async function handleSubscriptionLifecycleEvent(stripeSubscriptionId: string, newStatus: "ACTIVE" | "PAST_DUE" | "CANCELED") {
  const sub = await prisma.stripeSubscription.findUnique({ where: { stripeSubscriptionId } });
  if (!sub) return;

  await prisma.$transaction(async (tx) => {
    await tx.stripeSubscription.update({ where: { id: sub.id }, data: { status: newStatus } });
    await recomputeCompanyPlan(tx, sub.companyId, newStatus === "ACTIVE" ? "RESTORED" : newStatus, null);
  });
}

// Tee残高の「購入履歴・利用履歴」に出すプラン変更の記録
export async function listPlanChangeEvents(companyId: string) {
  const events = await prisma.planChangeEvent.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 100 });
  const userIds = [...new Set(events.map((e) => e.byUserId).filter((id): id is string => Boolean(id)))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return events.map((e) => ({ ...e, byUserName: e.byUserId ? (nameOf.get(e.byUserId) ?? null) : null }));
}
