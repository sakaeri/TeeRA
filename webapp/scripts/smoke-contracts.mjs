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
  await admin.click("text=＋スタッフを追加する");
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

  // admin: create a template
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("倉庫内軽作業");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1200");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);
  let body = await admin.textContent("body");
  log("template created and editable", body.includes("アルバイト・倉庫内軽作業") && body.includes("編集可能"));

  // admin: generate a contract for this specific staff (self-service picking
  // was removed — staff can only consent to a contract an admin prepared)
  await admin.goto("http://localhost:3000/company/roster");
  await admin.reload();
  await admin.waitForTimeout(500);
  await admin.locator("tbody tr", { hasText: "契約スタッフ" }).click();
  await admin.waitForTimeout(300);
  const panel = admin.locator("div.fixed.inset-0.z-30").first();
  await panel.getByRole("button", { name: "契約書管理" }).click();
  await panel.getByRole("button", { name: "＋契約書を生成" }).click();
  await admin.waitForTimeout(200);
  const choose = admin.locator("div.fixed.inset-0.z-30").last();
  await choose.locator("select").selectOption({ index: 1 });
  await choose.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  const gen = admin.locator("div.fixed.inset-0.z-30").last();
  await gen.getByRole("button", { name: "生成する" }).click();
  await admin.waitForTimeout(700);

  // staff: review and consent to the contract
  await staff.goto("http://localhost:3000/staff/contracts");
  body = await staff.textContent("body");
  log("staff sees the contract prepared for them, awaiting consent", body.includes("新しい契約書があります") && body.includes("1200円"));

  await staff.getByRole("button", { name: "内容を確認しました（同意する）" }).click();
  await staff.waitForTimeout(600);
  body = await staff.textContent("body");
  log("staff now shows contract as 契約中", body.includes("契約中") && body.includes("1200円"));

  // admin: template should now be locked
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
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
