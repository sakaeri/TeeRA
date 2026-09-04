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

const adminEmail = `invite-admin-${Date.now()}@example.com`;
const staffEmail = `invite-staff-${Date.now()}@example.com`;
const companyName = `招待確認株式会社${Date.now()}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "招待確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  const token = inviteUrl.split("/invite/")[1];
  log("招待URLが発行された", Boolean(token));

  await staff.goto(inviteUrl);
  console.log("invite landing:", staff.url());
  const preLoginText = await staff.textContent("body");
  log("招待画面（ログイン前）に会社名が表示される", preLoginText.includes(companyName));

  await staff.click("text=アカウントを作成して参加する");
  await staff.waitForURL(new RegExp(`/register\\?invite=${token}`));
  await staff.fill("#name", "招待スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");

  await staff.waitForURL(`http://localhost:3000/invite/${token}`, { timeout: 10000 });
  console.log("back on invite page after register:", staff.url());

  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff", { timeout: 10000 });
  console.log("landed on:", staff.url());

  const staffPageText = await staff.textContent("body");
  log("スタッフ画面に正しい会社名が表示される（サイドバー）", staffPageText.includes(companyName));

  console.log(process.exitCode ? "INVITE SMOKE TEST HAD FAILURES" : "INVITE SMOKE TEST PASSED");
} catch (err) {
  console.error("INVITE SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-invite-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-invite-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
