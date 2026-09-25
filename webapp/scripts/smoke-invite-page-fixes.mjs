import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

// 招待ページの2つの不具合を検証する：
// ①架空派遣会社タグ付きスタッフ招待のURLを開いても、対象の派遣会社名が
//   一切表示されず、通常の自社スタッフ招待と区別がつかなかった
// ②招待リンクが「使用済み」「すでに所属済み」等の行き止まり状態になった
//   時、アプリへ戻るリンクが一切無かった

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
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminEmail = `invpf-admin-${Date.now()}@example.com`;
const staffEmail = `invpf-staff-${Date.now()}@example.com`;
const companyName = `招待表示確認株式会社${Date.now()}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "招待表示確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}' order by "createdAt" desc limit 1;`);

  // --- ①架空派遣会社タグ付き招待に対象の派遣会社名が出るか ---
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "clientCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${companyId}', null, '招待表示確認テスト架空派遣', 'ACTIVE', now()) returning id) select id from ins;`,
  );
  void relId;

  await admin.goto("http://localhost:3000/company/roster");
  await admin.getByRole("button", { name: /派遣会社一覧/ }).click();
  await admin.waitForTimeout(300);
  await admin.click("text=招待表示確認テスト架空派遣");
  await admin.waitForTimeout(400);
  const panel = admin.locator("div.fixed.inset-0.z-30, div.fixed.inset-0.z-20").last();
  await panel.getByRole("button", { name: "スタッフ一覧" }).click();
  await admin.waitForTimeout(300);
  await panel.getByRole("button", { name: "＋派遣スタッフを招待" }).click();
  await admin.waitForTimeout(300);
  await panel.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const agencyInviteUrl = await panel.locator('input[readonly]').inputValue();

  await staff.goto(agencyInviteUrl);
  const landingBody = await staff.textContent("body");
  log(
    "派遣スタッフ招待ページに対象の派遣会社名が表示される",
    landingBody.includes("招待表示確認テスト架空派遣の派遣スタッフ"),
  );
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "招待表示確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  const staffUserId = psql(`select id from "User" where email='${staffEmail.toLowerCase()}';`);
  const taggedRelId = psql(`select "viaAgencyRelationshipId" from "CompanyMembership" where "userId"='${staffUserId}';`);
  log("参加後、正しくタグ付けされる", taggedRelId === relId);

  // --- ②行き止まり状態に「ログイン」ボタンがあるか ---
  // 同じ会社宛のスタッフ招待をもう1つ発行し、既にこの会社のメンバーである
  // スタッフ（上で作成済み）に開かせて「すでに所属しています」状態を作る。
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const secondInviteUrl = await admin.locator('input[readonly]').inputValue();

  await staff.goto(secondInviteUrl);
  const dupBody = await staff.textContent("body");
  log("すでに所属済みの会社への招待を開くと専用メッセージが出る", dupBody.includes("すでにこの会社に所属しています"));
  log("「ログイン」ボタンが表示される（行き止まりにならない）", dupBody.includes("ログイン"));

  await staff.getByRole("link", { name: "ログイン" }).click();
  await staff.waitForTimeout(500);
  log("リンクを押すとアプリ側に遷移する（招待ページのままではない）", !staff.url().includes("/invite/"));

  console.log(process.exitCode ? "INVITE PAGE FIXES SMOKE TEST HAD FAILURES" : "INVITE PAGE FIXES SMOKE TEST PASSED");
} catch (err) {
  console.error("INVITE PAGE FIXES SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
