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

// 招待→ログイン→招待画面に戻る→連携、という導線の検証。以前は招待画面
// （未ログイン時）に「アカウントを作成して参加する」しか無く、既存アカウント
// を持つ人がログインして続きをする導線が無かった（新規登録フォームの
// 「ログイン」リンクもinvite文脈を引き継いでいなかった）。

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminEmail = `ilf-admin-${Date.now()}@example.com`;
const staffEmail = `ilf-staff-${Date.now()}@example.com`;
const companyName = `ログイン導線確認株式会社${Date.now()}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "ログイン導線確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  // スタッフ役の人は、招待を受ける前に別ルートで先に自分のアカウントだけ
  // 作っておく（招待とは無関係に既にアカウントを持っている状態を再現）。
  await staff.goto("http://localhost:3000/register");
  await staff.fill("#name", "ログイン導線確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL("http://localhost:3000/register/company");
  // ログアウトして「未ログイン状態で招待URLを開く」を再現する
  await staff.context().clearCookies();

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  const token = inviteUrl.split("/invite/")[1];

  // 未ログインで招待URLを開く
  await staff.goto(inviteUrl);
  let bodyText = await staff.textContent("body");
  log("未ログイン時、アカウント作成の案内が出る", bodyText.includes("アカウントを作成して参加する"));
  log("未ログイン時、ログインへの導線も出ている", bodyText.includes("ログイン"));

  const loginLink = await staff.getByRole("link", { name: "ログイン", exact: true }).getAttribute("href");
  log("ログインリンクがinvite先を覚えている（from=/invite/token）", loginLink === `/login?from=/invite/${token}`);

  await staff.getByRole("link", { name: "ログイン", exact: true }).click();
  await staff.waitForURL(new RegExp("/login"), { timeout: 15000 });
  bodyText = await staff.textContent("body");
  log("ログイン画面に遷移する", bodyText.includes("ログイン"));

  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.getByRole("button", { name: "ログイン", exact: true }).click();
  await staff.waitForURL(`http://localhost:3000/invite/${token}`, { timeout: 10000 });
  log("ログイン後、招待画面に自動で戻ってくる", staff.url().endsWith(`/invite/${token}`));

  bodyText = await staff.textContent("body");
  log("招待画面で「参加する」ボタンが出る", bodyText.includes("参加する"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff", { timeout: 10000 });
  log("連携が完了し/staffに入れる", staff.url().endsWith("/staff"));

  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  const membershipExists = psql(
    `select count(*) from "CompanyMembership" where "userId"='${staffUserId}' and "companyId"='${companyId}';`,
  );
  log("既存アカウントにCompanyMembershipが作成された", membershipExists === "1");

  console.log(process.exitCode ? "INVITE LOGIN FLOW SMOKE TEST HAD FAILURES" : "INVITE LOGIN FLOW SMOKE TEST PASSED");
} catch (err) {
  console.error("INVITE LOGIN FLOW SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-invite-login-flow-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-invite-login-flow-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
