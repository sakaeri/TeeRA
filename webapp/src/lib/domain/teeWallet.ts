import "server-only";
import { prisma } from "@/lib/prisma";
import { requireStripe, teeYenPerUnit } from "@/lib/stripe";
import { postLedgerEntry } from "@/lib/domain/wallet";

export async function createStripeCheckoutSession(params: {
  companyId: string;
  teeAmount: number;
  returnUrl: string;
}) {
  const stripe = requireStripe();
  const yenAmount = params.teeAmount * teeYenPerUnit();

  // ui_mode: "embedded_page" はcheckout.stripe.comへ遷移させず、自ページ内に
  // Stripeがホストするカード入力フォーム（iframe）を埋め込む方式（このStripe
  // アカウントのAPIバージョンでは旧名称"embedded"は廃止されている）。カード
  // 情報自体は引き続きStripe側だけが扱うのでPCI DSS対応は変わらない。
  // redirect_on_completion: "if_required"で、カード決済（リダイレクト不要）
  // ではreturn_urlへ飛ばさず、クライアント側のonCompleteコールバックだけで
  // 完了を扱う（モーダルを閉じて画面を更新する形にできる）。
  const session = await stripe.checkout.sessions.create({
    ui_mode: "embedded_page",
    redirect_on_completion: "if_required",
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
    return_url: params.returnUrl,
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
