import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

// 2つの不具合を検証する：
// ①CLIENT_UPGRADE/AGENCY_UPGRADE（既存の仮依頼主/仮派遣会社を本アカウント
//   と連携する招待）のURLを開いても、対象の仮会社名が一切表示されず、単に
//   「依頼主」「派遣会社」としか出なかった
// ②仮スタッフを本アカウントと連携すると、CompanyMembership/TeamMembership
//   以外のstaffUserId参照（シフト・業務報告等）が実アカウントへ付け替え
//   られず、仮User削除時にカスケード削除されて消えてしまっていた

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

const agencyCtx = await browser.newContext();
const agency = await agencyCtx.newPage();
const clientCtx = await browser.newContext();
const client = await clientCtx.newPage();

const agencyAdminEmail = `puf-agency-${Date.now()}@example.com`;
const clientAdminEmail = `puf-client-${Date.now()}@example.com`;
const agencyCompanyName = `本アカ連携確認派遣元株式会社${Date.now()}`;
const clientCompanyName = `本アカ連携確認依頼主株式会社${Date.now()}`;

try {
  // --- ①CLIENT_UPGRADE招待に対象の仮依頼主名が出るか ---
  await agency.goto("http://localhost:3000/register");
  await agency.fill("#name", "本アカ連携確認派遣元管理者");
  await agency.fill("#email", agencyAdminEmail);
  await agency.fill("#password", "password123");
  await agency.click("button[type=submit]");
  await agency.waitForURL("http://localhost:3000/register/company");
  await agency.fill("#name", agencyCompanyName);
  await agency.click("button[type=submit]");
  await agency.waitForURL("http://localhost:3000/company");
  const agencyCompanyId = psql(`select id from "Company" where name='${agencyCompanyName}';`);

  await agency.goto("http://localhost:3000/company/roster");
  await agency.getByRole("button", { name: "依頼主一覧" }).click();
  await agency.getByRole("button", { name: "＋依頼主を追加" }).click();
  await agency.getByRole("button", { name: "仮アカウントを作成" }).click();
  await agency.getByPlaceholder("名称を入力").fill("仮依頼主本アカ連携テスト社");
  await agency.getByRole("button", { name: "作成" }).click();
  await agency.waitForTimeout(500);

  await agency.click("text=仮依頼主本アカ連携テスト社");
  await agency.waitForTimeout(400);
  const panel = agency.locator("div.fixed.inset-0.z-30, div.fixed.inset-0.z-20").last();
  await panel.getByRole("button", { name: "本アカウントと連携する" }).click();
  await agency.waitForSelector('input[readonly]');
  const clientUpgradeUrl = await panel.locator('input[readonly]').inputValue();

  await client.goto("http://localhost:3000/register");
  await client.fill("#name", "本アカ連携確認依頼主管理者");
  await client.fill("#email", clientAdminEmail);
  await client.fill("#password", "password123");
  await client.click("button[type=submit]");
  await client.waitForURL("http://localhost:3000/register/company");
  await client.fill("#name", clientCompanyName);
  await client.click("button[type=submit]");
  await client.waitForURL("http://localhost:3000/company");

  await client.goto(clientUpgradeUrl);
  const landingBody = await client.locator("body").innerText();
  log(
    "本アカウント連携ページに対象の仮依頼主名が表示される",
    landingBody.includes("仮依頼主本アカ連携テスト社"),
  );

  await client.getByRole("button", { name: `${clientCompanyName}として招待を受け取る` }).click();
  await client.waitForTimeout(500);
  const relRow = psql(
    `select "clientCompanyId" from "CompanyRelationship" where "ownerCompanyId"='${agencyCompanyId}' and "proxyName"='仮依頼主本アカ連携テスト社';`,
  );
  const clientCompanyId = psql(`select id from "Company" where name='${clientCompanyName}';`);
  log("受諾後、正しく依頼主企業がリンクされる", relRow === clientCompanyId);

  // --- ②仮スタッフの本アカウント連携でシフト等が消えないか ---
  const staffCtx = await browser.newContext();
  const staff = await staffCtx.newPage();
  await staff.goto("http://localhost:3000/register");
  const staffAdminEmail = `puf-staffadmin-${Date.now()}@example.com`;
  await staff.fill("#name", "本アカ連携確認スタッフ管理者");
  await staff.fill("#email", staffAdminEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL("http://localhost:3000/register/company");
  const staffTestCompanyName = `本アカ連携確認スタッフ会社${Date.now()}`;
  await staff.fill("#name", staffTestCompanyName);
  await staff.click("button[type=submit]");
  await staff.waitForURL("http://localhost:3000/company");
  const staffTestCompanyId = psql(`select id from "Company" where name='${staffTestCompanyName}';`);

  await staff.goto("http://localhost:3000/company/roster");
  await staff.getByRole("button", { name: "＋スタッフを追加" }).click();
  await staff.getByRole("button", { name: "仮アカウントを作成" }).click();
  await staff.getByPlaceholder("名称を入力").fill("仮スタッフ本アカ連携テスト");
  await staff.getByRole("button", { name: "作成" }).click();
  await staff.waitForTimeout(500);
  const proxyUserId = psql(
    `select u.id from "User" u join "CompanyMembership" cm on cm."userId"=u.id where u.name='仮スタッフ本アカ連携テスト' and cm."companyId"='${staffTestCompanyId}';`,
  );

  // 仮スタッフにシフト・業務報告の実績データを作る
  const shiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", "taskName", status, "createdVia", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${staffTestCompanyId}', '${proxyUserId}', 'INHOUSE', '2026-09-20', '09:00', '18:00', '本アカ連携確認業務', 'CONFIRMED', 'ASSIGN', now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "clockIn", "clockOut", "submittedAt", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${shiftId}', '${proxyUserId}', 'WORKED', now(), now(), now(), now(), now());`,
  );
  const shiftCountBefore = psql(`select count(*) from "Shift" where "staffUserId"='${proxyUserId}';`);
  const workReportCountBefore = psql(`select count(*) from "WorkReport" where "staffUserId"='${proxyUserId}';`);
  log("事前準備: 仮スタッフにシフトが1件ある", shiftCountBefore === "1");
  log("事前準備: 仮スタッフに業務報告が1件ある", workReportCountBefore === "1");

  await staff.goto("http://localhost:3000/company/roster");
  await staff.click("text=仮スタッフ本アカ連携テスト");
  await staff.waitForTimeout(400);
  const staffPanel = staff.locator("div.fixed.inset-0.z-30, div.fixed.inset-0.z-20").last();
  await staffPanel.getByRole("button", { name: "本アカウントと連携する" }).click();
  await staff.waitForSelector('input[readonly]');
  const staffUpgradeUrl = await staffPanel.locator('input[readonly]').inputValue();

  const upgradeCtx = await browser.newContext();
  const upgradePage = await upgradeCtx.newPage();
  const realStaffEmail = `puf-realstaff-${Date.now()}@example.com`;
  await upgradePage.goto(staffUpgradeUrl);
  await upgradePage.click("text=アカウントを作成して参加する");
  await upgradePage.fill("#name", "本アカ連携確認スタッフ本人");
  await upgradePage.fill("#email", realStaffEmail);
  await upgradePage.fill("#password", "password123");
  await upgradePage.click("button[type=submit]");
  await upgradePage.waitForURL(new RegExp("/invite/"));
  await upgradePage.click("text=参加する");
  await upgradePage.waitForURL("http://localhost:3000/staff");

  const realStaffUserId = psql(`select id from "User" where email='${realStaffEmail.toLowerCase()}';`);
  const proxyStillExists = psql(`select count(*) from "User" where id='${proxyUserId}';`);
  log("連携後、仮Userは削除されている", proxyStillExists === "0");

  const shiftCountAfterOnProxy = psql(`select count(*) from "Shift" where "staffUserId"='${proxyUserId}';`);
  const shiftCountAfterOnReal = psql(`select count(*) from "Shift" where "staffUserId"='${realStaffUserId}';`);
  log(
    "連携後もシフトが消えず、実アカウントへ付け替えられている",
    shiftCountAfterOnProxy === "0" && shiftCountAfterOnReal === "1",
  );

  const workReportCountAfterOnReal = psql(`select count(*) from "WorkReport" where "staffUserId"='${realStaffUserId}';`);
  log("連携後も業務報告が消えず、実アカウントへ付け替えられている", workReportCountAfterOnReal === "1");

  console.log(process.exitCode ? "PROXY UPGRADE FIXES SMOKE TEST HAD FAILURES" : "PROXY UPGRADE FIXES SMOKE TEST PASSED");
} catch (err) {
  console.error("PROXY UPGRADE FIXES SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
