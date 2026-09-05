import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

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

// body.textContent() also picks up stale __next_f RSC payload <script> tags
// left behind by earlier client-side navigations, so it can't reliably tell
// which company is "currently active" (an old company name lingers in that
// script noise even after switching away). The profile-menu panel's company
// chip is a real, freshly-rendered element for the CURRENT page only, so
// scope the read to it instead.
async function currentStaffCompanyName(page) {
  const alreadyOpen = await page.locator('button[aria-label="プロフィールメニュー"] + div').isVisible().catch(() => false);
  if (!alreadyOpen) {
    await page.click('button[aria-label="プロフィールメニュー"]');
    await page.waitForTimeout(200);
  }
  return page.locator('button[aria-label="プロフィールメニュー"] + div > div.rounded-lg.bg-background').textContent();
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminACtx = await browser.newContext();
const adminA = await adminACtx.newPage();
const adminBCtx = await browser.newContext();
const adminB = await adminBCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminAEmail = `mc-adminA-${Date.now()}@example.com`;
const adminBEmail = `mc-adminB-${Date.now()}@example.com`;
const staffEmail = `mc-staff-${Date.now()}@example.com`;
const companyAName = `複数社確認A社${Date.now()}`;
const companyBName = `複数社確認B社${Date.now()}`;

try {
  // --- setup: two independent companies, each run by their own admin ---
  await adminA.goto("http://localhost:3000/register");
  await adminA.fill("#name", "複数社確認管理者A");
  await adminA.fill("#email", adminAEmail);
  await adminA.fill("#password", "password123");
  await adminA.click("button[type=submit]");
  await adminA.waitForURL("http://localhost:3000/register/company");
  await adminA.fill("#name", companyAName);
  await adminA.click("button[type=submit]");
  await adminA.waitForURL("http://localhost:3000/company");

  await adminB.goto("http://localhost:3000/register");
  await adminB.fill("#name", "複数社確認管理者B");
  await adminB.fill("#email", adminBEmail);
  await adminB.fill("#password", "password123");
  await adminB.click("button[type=submit]");
  await adminB.waitForURL("http://localhost:3000/register/company");
  await adminB.fill("#name", companyBName);
  await adminB.click("button[type=submit]");
  await adminB.waitForURL("http://localhost:3000/company");

  // --- staff invite from company A: brand-new account, redeems normally ---
  await adminA.goto("http://localhost:3000/company/roster");
  await adminA.click("text=＋スタッフを追加する");
  await adminA.click("text=本アカウントを招待");
  await adminA.getByRole("button", { name: "招待URLを発行する" }).click();
  await adminA.waitForSelector('input[readonly]');
  const inviteAUrl = await adminA.locator('input[readonly]').inputValue();

  await staff.goto(inviteAUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "複数社確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(/\/invite\//, { timeout: 10000 });
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff", { timeout: 10000 });
  log("staff redeemed company A's invite and landed on /staff", staff.url().includes("/staff"));

  // --- ① ダブルワーク: same account redeems a SECOND company's staff invite
  // — this used to be hard-blocked ("すでに別の本部に所属") whenever the
  // user had ANY membership anywhere. Now it should only block if they are
  // already a member of THIS SAME company. ---
  await adminB.goto("http://localhost:3000/company/roster");
  await adminB.click("text=＋スタッフを追加する");
  await adminB.click("text=本アカウントを招待");
  await adminB.getByRole("button", { name: "招待URLを発行する" }).click();
  await adminB.waitForSelector('input[readonly]');
  const inviteBUrl = await adminB.locator('input[readonly]').inputValue();

  await staff.goto(inviteBUrl);
  const bodyBeforeRedeemB = await staff.textContent("body");
  log(
    "already-logged-in staff is NOT blocked from a second company's invite",
    !bodyBeforeRedeemB.includes("すでにこの会社に所属しています") && bodyBeforeRedeemB.includes("参加する"),
  );
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/home", { timeout: 10000 });
  log("redeeming a 2nd company's invite is no longer blocked", staff.url().includes("/home"));

  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);
  const membershipCount = Number(
    psql(`select count(*) from "CompanyMembership" where "userId"='${staffUserId}';`),
  );
  log("staff now has exactly 2 CompanyMembership rows (both kept)", membershipCount === 2);

  // --- ② /homeでCookieが無ければ選択画面が出る ---
  // (scoped to <main>, not body.textContent(), since the body also carries
  // stale __next_f RSC payload <script> tags from earlier navigations)
  let homeMainText = await staff.locator("main").textContent();
  log("no active-company cookie yet -> /home shows a picker", homeMainText.includes("会社を選択してください"));
  log("picker lists both companies", homeMainText.includes(companyAName) && homeMainText.includes(companyBName));

  // --- ③ 選択後は正しい会社のダッシュボードに入る ---
  await staff.click(`text=${companyBName}`);
  await staff.waitForURL("http://localhost:3000/staff", { timeout: 10000 });
  log("selecting company B lands on /staff showing company B's name", (await currentStaffCompanyName(staff)).includes(companyBName));

  // revisiting /home directly now should skip the picker (cookie remembers B)
  await staff.goto("http://localhost:3000/home");
  await staff.waitForURL("http://localhost:3000/staff", { timeout: 10000 });
  log("revisiting /home with a valid cookie auto-redirects (no picker)", staff.url().endsWith("/staff"));

  // --- ④ 切替リンクでもう一方の会社に戻れる ---
  // (the /home goto above was a full navigation, so the profile menu closed again)
  await staff.click('button[aria-label="プロフィールメニュー"]');
  await staff.waitForTimeout(200);
  const menuText = await staff.locator('button[aria-label="プロフィールメニュー"] + div').textContent();
  log("switch link is shown for a multi-company staff account", menuText.includes("会社を切り替える"));
  await staff.click("text=会社を切り替える");
  await staff.waitForURL(/\/home\?switch=1/, { timeout: 10000 });
  homeMainText = await staff.locator("main").textContent();
  log("?switch=1 bypasses the cookie and shows the picker again", homeMainText.includes("会社を選択してください"));

  await staff.click(`text=${companyAName}`);
  await staff.waitForURL("http://localhost:3000/staff", { timeout: 10000 });
  log("switching back to company A lands on /staff showing company A's name", (await currentStaffCompanyName(staff)).includes(companyAName));

  console.log(process.exitCode ? "MULTI-COMPANY SMOKE TEST HAD FAILURES" : "MULTI-COMPANY SMOKE TEST PASSED");
} catch (err) {
  console.error("MULTI-COMPANY SMOKE TEST FAILED", err);
  await adminA.screenshot({ path: "/tmp/smoke-multi-company-adminA-failure.png" });
  await adminB.screenshot({ path: "/tmp/smoke-multi-company-adminB-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-multi-company-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
