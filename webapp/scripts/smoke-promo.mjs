import { chromium } from "playwright-core";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminEmail = `promo-admin-${Date.now()}@example.com`;
const staffEmail = `promo-staff-${Date.now()}@example.com`;
const today = new Date().toISOString().slice(0, 10);

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "販促品管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "販促品テスト株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  // register a promo item costing 1pt, stock 2
  await admin.goto("http://localhost:3000/company/promo");
  await admin.click("text=＋販促品を登録");
  await admin.fill('input[placeholder="画像URL"]', "https://example.com/mug.png");
  await admin.fill('input[placeholder="商品名"]', "オリジナルマグカップ");
  await admin.fill('input[placeholder="交換ポイント"]', "1");
  await admin.fill('input[placeholder="在庫数"]', "2");
  await admin.getByRole("button", { name: "登録する" }).click();
  await admin.waitForTimeout(600);
  let body = await admin.textContent("body");
  log("promo item created", body.includes("オリジナルマグカップ") && body.includes("在庫 2"));

  // invite + register staff
  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを招待する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "販促品スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  // shift + report + approve to earn 1pt
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  await admin.waitForSelector('input[type="date"]');
  await admin.fill('input[type=date]', today);
  await admin.getByRole("button", { name: "作成する" }).click();
  await admin.waitForTimeout(800);

  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.getByRole("button", { name: "出勤" }).click();
  await staff.waitForTimeout(400);
  await staff.getByRole("button", { name: "退勤" }).click();
  await staff.waitForTimeout(400);
  await staff.getByRole("button", { name: "業務報告を提出する" }).click();
  await staff.waitForTimeout(600);

  await admin.goto("http://localhost:3000/company/workreports");
  await admin.getByRole("button", { name: "承認する" }).click();
  await admin.waitForTimeout(600);

  // staff checks points page
  await staff.goto("http://localhost:3000/staff/points");
  body = await staff.textContent("body");
  log("staff has 1pt", body.includes("1pt") && body.includes("承認済み業務報告 1件"));

  // redeem
  await staff.getByRole("button", { name: "交換する" }).click();
  await staff.waitForTimeout(700);
  body = await staff.textContent("body");
  log("item now shows as redeemed", body.includes("交換済み"));

  await staff.click("text=交換履歴");
  body = await staff.textContent("body");
  log("redemption appears in order history as 発送待ち", body.includes("オリジナルマグカップ") && body.includes("発送待ち"));

  // balance should be back to 0
  await staff.goto("http://localhost:3000/staff/points");
  body = await staff.textContent("body");
  log("balance back to 0pt after redemption", body.includes("0pt"));

  // admin sees pending shipment, marks shipped
  await admin.goto("http://localhost:3000/company/promo");
  body = await admin.textContent("body");
  log("admin sees pending shipment and reduced stock", body.includes("販促品スタッフ") && body.includes("在庫 1"));

  await admin.getByRole("button", { name: "発送済みにする" }).click();
  await admin.waitForTimeout(600);
  body = await admin.textContent("body");
  log("no more pending shipments after marking shipped", body.includes("発送待ちの注文はありません"));

  await staff.goto("http://localhost:3000/staff/points");
  await staff.click("text=交換履歴");
  body = await staff.textContent("body");
  log("staff sees order as 発送済み", body.includes("発送済み"));

  console.log(process.exitCode ? "PROMO SMOKE TEST HAD FAILURES" : "PROMO SMOKE TEST PASSED");
} catch (err) {
  console.error("PROMO SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-promo-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-promo-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
