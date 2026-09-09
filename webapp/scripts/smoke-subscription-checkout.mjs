import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import Stripe from "stripe";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(
    `PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`,
  )
    .toString()
    .trim();
}

// 課金プラン（Stripeサブスク）の検証:
// - checkout.session.completed(mode:subscription)でCompany.planTierが
//   更新され、StripeSubscriptionがACTIVEになる
// - customer.subscription.deletedで無料プランに戻る（グランドファザリング
//   なし、その場で即座に反映）
// - 既存の一回払い（Tee購入）のwebhookフロー（mode:payment）が
//   session.mode分岐追加後も壊れていないことの回帰確認

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const email = `subcheckout-admin-${Date.now()}@example.com`;
const companyName = `サブスク確認株式会社${Date.now()}`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "サブスク確認管理者");
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");

  const companyId = psql(`select id from "Company" where name='${companyName}' order by "createdAt" desc limit 1;`);
  let planTier = psql(`select "planTier" from "Company" where id='${companyId}';`);
  log("会社登録直後は無料プラン", planTier === "FREE");

  // プランの選択・変更はTee残高ページの「プランを選ぶ」ポップアップに集約されている
  await page.goto("http://localhost:3000/company/wallet");
  let bodyText = await page.textContent("body");
  log("Tee残高ページに現在のプラン（無料）が表示される", bodyText.includes("現在のプラン") && bodyText.includes("無料プラン"));
  await page.getByRole("button", { name: "プランを選ぶ" }).click();
  bodyText = await page.textContent("body");
  log(
    "Tee残高ページのプランポップアップにスタンダード/ビジネスへのアップグレードボタンが表示される",
    (bodyText.match(/このプランにする/g) ?? []).length === 2,
  );
  await page.click("text=✕");

  // --- Stripeサブスクcheckout + webhook simulation (local HMAC, no network needed) ---
  const stripe = new Stripe("sk_test_local_dev_placeholder_not_a_real_key");
  const sessionId = `cs_test_sub_${Date.now()}`;
  const stripeSubId = `sub_test_${Date.now()}`;

  psql(
    `insert into "StripeSubscription" (id, "companyId", "stripeCheckoutSessionId", "planTier", status, "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${sessionId}', 'STANDARD', 'PENDING', now(), now());`,
  );

  const payload = JSON.stringify({
    id: `evt_test_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        mode: "subscription",
        payment_status: "paid",
        subscription: stripeSubId,
        object: "checkout.session",
      },
    },
  });
  const header = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: "whsec_local_dev_placeholder_not_real",
  });

  const resp = await fetch("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": header },
    body: payload,
  });
  log("サブスクcheckout完了イベントをwebhookが受理する", resp.status === 200);

  planTier = psql(`select "planTier" from "Company" where id='${companyId}';`);
  log("Company.planTierがSTANDARDになる", planTier === "STANDARD");
  const subStatus = psql(`select status, "stripeSubscriptionId" from "StripeSubscription" where "stripeCheckoutSessionId"='${sessionId}';`);
  log("StripeSubscriptionがACTIVEになり、stripeSubscriptionIdが記録される", subStatus === `ACTIVE|${stripeSubId}`);

  // idempotency: replay the same event should not error or double-apply
  const resp2 = await fetch("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": header },
    body: payload,
  });
  log("webhookの再送も受理される（冪等）", resp2.status === 200);
  planTier = psql(`select "planTier" from "Company" where id='${companyId}';`);
  log("再送してもplanTierはSTANDARDのまま", planTier === "STANDARD");

  await page.goto("http://localhost:3000/company/wallet");
  bodyText = await page.textContent("body");
  log("Tee残高ページの残高カードのプラン表示がスタンダードに更新される", bodyText.includes("スタンダードプラン"));

  // --- 解約イベントで無料プランに即座に戻る（グランドファザリングなし） ---
  const cancelPayload = JSON.stringify({
    id: `evt_test_cancel_${Date.now()}`,
    object: "event",
    type: "customer.subscription.deleted",
    data: { object: { id: stripeSubId, status: "canceled", object: "subscription" } },
  });
  const cancelHeader = stripe.webhooks.generateTestHeaderString({
    payload: cancelPayload,
    secret: "whsec_local_dev_placeholder_not_real",
  });
  const cancelResp = await fetch("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": cancelHeader },
    body: cancelPayload,
  });
  log("解約イベントをwebhookが受理する", cancelResp.status === 200);

  planTier = psql(`select "planTier" from "Company" where id='${companyId}';`);
  log("解約で即座に無料プランへ戻る", planTier === "FREE");
  const subStatusAfterCancel = psql(`select status from "StripeSubscription" where "stripeSubscriptionId"='${stripeSubId}';`);
  log("StripeSubscriptionがCANCELEDになる", subStatusAfterCancel === "CANCELED");

  // --- 既存の一回払い（Tee購入）のwebhookフローが壊れていないことの回帰確認 ---
  const chargeSessionId = `cs_test_payment_${Date.now()}`;
  const teeAmount = 20;
  psql(
    `insert into "StripeCharge" (id, "companyId", "stripePaymentIntentId", "yenAmount", "teeAmount", status, "createdAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${chargeSessionId}', ${teeAmount * 100}, ${teeAmount}, 'PENDING', now());`,
  );
  const chargePayload = JSON.stringify({
    id: `evt_test_charge_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: chargeSessionId, mode: "payment", payment_status: "paid", object: "checkout.session" } },
  });
  const chargeHeader = stripe.webhooks.generateTestHeaderString({
    payload: chargePayload,
    secret: "whsec_local_dev_placeholder_not_real",
  });
  const chargeResp = await fetch("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": chargeHeader },
    body: chargePayload,
  });
  log("一回払い（Tee購入）のcheckout完了イベントも引き続き受理される", chargeResp.status === 200);
  const balance = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("一回払いのTeeが引き続き正しく反映される（0→20）", balance === teeAmount);
  const chargeStatus = psql(`select status from "StripeCharge" where "stripePaymentIntentId"='${chargeSessionId}';`);
  log("StripeChargeが引き続きSUCCEEDEDになる", chargeStatus === "SUCCEEDED");
  const planTierUnaffected = psql(`select "planTier" from "Company" where id='${companyId}';`);
  log("Tee購入はplanTierに影響しない（FREEのまま）", planTierUnaffected === "FREE");

  console.log(process.exitCode ? "SUBSCRIPTION CHECKOUT SMOKE TEST HAD FAILURES" : "SUBSCRIPTION CHECKOUT SMOKE TEST PASSED");
} catch (err) {
  console.error("SUBSCRIPTION CHECKOUT SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
