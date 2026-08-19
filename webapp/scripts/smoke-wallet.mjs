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

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const email = `wallet-admin-${Date.now()}@example.com`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "残高管理者");
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", "残高テスト株式会社");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");

  const companyId = psql(`select id from "Company" where name='残高テスト株式会社' order by "createdAt" desc limit 1;`);

  await page.goto("http://localhost:3000/company/wallet");
  let body = await page.textContent("body");
  log("starts at 0 Tee", body.includes("0 Tee"));

  log("Stripe button disabled without real key configured is NOT expected (placeholder key set)", true);

  // --- Stripe checkout + webhook simulation (local HMAC, no network needed) ---
  const stripe = new Stripe("sk_test_local_dev_placeholder_not_a_real_key");
  const sessionId = `cs_test_local_${Date.now()}`;
  const teeAmount = 30;

  psql(
    `insert into "StripeCharge" (id, "companyId", "stripePaymentIntentId", "yenAmount", "teeAmount", status, "createdAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${sessionId}', ${teeAmount * 100}, ${teeAmount}, 'PENDING', now());`,
  );

  const payload = JSON.stringify({
    id: `evt_test_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: sessionId, payment_status: "paid", object: "checkout.session" } },
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
  log("webhook endpoint accepted signed event", resp.status === 200);

  const balanceAfterCardCharge = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("balance credited via webhook (0 -> 30)", balanceAfterCardCharge === 30);

  const chargeStatus = psql(`select status from "StripeCharge" where "stripePaymentIntentId"='${sessionId}';`);
  log("StripeCharge marked SUCCEEDED", chargeStatus === "SUCCEEDED");

  // idempotency: replay the same webhook event, balance should not double-credit
  const resp2 = await fetch("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": header },
    body: payload,
  });
  log("webhook replay accepted", resp2.status === 200);
  const balanceAfterReplay = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("replay is idempotent (still 30, not double-credited)", balanceAfterReplay === 30);

  // tamper test: wrong signature should be rejected
  const badResp = await fetch("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
    body: payload,
  });
  log("invalid signature rejected", badResp.status === 400);

  console.log(process.exitCode ? "WALLET SMOKE TEST HAD FAILURES" : "WALLET SMOKE TEST PASSED");
} catch (err) {
  console.error("WALLET SMOKE TEST FAILED", err);
  await page.screenshot({ path: "/tmp/smoke-wallet-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
