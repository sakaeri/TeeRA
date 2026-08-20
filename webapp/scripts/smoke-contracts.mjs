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

const adminEmail = `ct-admin-${Date.now()}@example.com`;
const staffEmail = `ct-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "契約管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "契約テスト株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを招待する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "契約スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  // admin: add a placement rate, create a template
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.fill('input[placeholder="業務内容"]', "軽作業");
  await admin.fill('input[placeholder="金額"]', "1200");
  await admin.getByRole("button", { name: "＋追加" }).click();
  await admin.waitForTimeout(500);
  let body = await admin.textContent("body");
  log("placement rate added", body.includes("軽作業") && body.includes("1200円"));

  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("倉庫内軽作業");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1200");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);
  body = await admin.textContent("body");
  log("template created and editable", body.includes("アルバイト・倉庫内軽作業") && body.includes("編集可能"));

  // staff: consent to the contract
  await staff.goto("http://localhost:3000/staff/contracts");
  body = await staff.textContent("body");
  log("staff sees available template", body.includes("アルバイト・倉庫内軽作業"));

  await staff.getByRole("button", { name: "契約を結ぶ" }).click();
  await staff.waitForTimeout(600);
  body = await staff.textContent("body");
  log("staff now shows contract as 契約中", body.includes("契約中") && body.includes("1200円"));

  // admin: template should now be locked
  await admin.reload();
  body = await admin.textContent("body");
  log("template locked after staff contracted", body.includes("使用中（編集は複製されます）") && body.includes("契約中: 契約スタッフ"));

  console.log(process.exitCode ? "CONTRACTS SMOKE TEST HAD FAILURES" : "CONTRACTS SMOKE TEST PASSED");
} catch (err) {
  console.error("CONTRACTS SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-contracts-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-contracts-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
