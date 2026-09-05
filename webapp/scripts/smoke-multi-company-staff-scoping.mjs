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

// フェーズ3の検証: 1人のスタッフが2社（A社・B社）で本当に稼働している状態
// を作り、A社のスタッフ画面にB社のシフト/お知らせ/契約が一切混ざらない
// ことを確認する（逆方向も同様）。フェーズ1-2で複数社所属自体は解禁
// 済みなので、ここでは各ドメイン関数のcompanyId絞り込みだけを見る。

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminACtx = await browser.newContext();
const adminA = await adminACtx.newPage();
const adminBCtx = await browser.newContext();
const adminB = await adminBCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminAEmail = `mcs-adminA-${Date.now()}@example.com`;
const adminBEmail = `mcs-adminB-${Date.now()}@example.com`;
const staffEmail = `mcs-staff-${Date.now()}@example.com`;
const companyAName = `絞込確認A社${Date.now()}`;
const companyBName = `絞込確認B社${Date.now()}`;

async function setupCompanyContract(admin, companyId, staffUserId, taskName, wageAmount) {
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill(taskName);
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("HOURLY");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill(String(wageAmount));
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);

  const templateId = psql(
    `select id from "ContractTemplate" where "companyId"='${companyId}' order by "createdAt" desc limit 1;`,
  );
  psql(
    `insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", "contractStartDate", status, "consentedAt", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${templateId}', '${staffUserId}', ${wageAmount}, current_date - interval '7 day', 'ACTIVE', now(), now(), now());`,
  );
  return templateId;
}

function seedShiftAndNotice(companyId, staffUserId, noticeMessage) {
  psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'INHOUSE', current_date, '09:00', '17:00', 'CONFIRMED', 'ASSIGN', now(), now());`,
  );
  psql(
    `insert into "StaffNotice" (id, "companyId", "staffUserId", message, "createdAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', '${noticeMessage}', now());`,
  );
}

async function switchTo(page, companyName) {
  await page.goto("http://localhost:3000/home?switch=1");
  await page.click(`text=${companyName}`);
  await page.waitForURL("http://localhost:3000/staff", { timeout: 10000 });
}

try {
  // --- setup: two companies, each run by their own admin ---
  await adminA.goto("http://localhost:3000/register");
  await adminA.fill("#name", "絞込確認管理者A");
  await adminA.fill("#email", adminAEmail);
  await adminA.fill("#password", "password123");
  await adminA.click("button[type=submit]");
  await adminA.waitForURL("http://localhost:3000/register/company");
  await adminA.fill("#name", companyAName);
  await adminA.click("button[type=submit]");
  await adminA.waitForURL("http://localhost:3000/company");
  const companyAId = psql(`select id from "Company" where name='${companyAName}';`);

  await adminB.goto("http://localhost:3000/register");
  await adminB.fill("#name", "絞込確認管理者B");
  await adminB.fill("#email", adminBEmail);
  await adminB.fill("#password", "password123");
  await adminB.click("button[type=submit]");
  await adminB.waitForURL("http://localhost:3000/register/company");
  await adminB.fill("#name", companyBName);
  await adminB.click("button[type=submit]");
  await adminB.waitForURL("http://localhost:3000/company");
  const companyBId = psql(`select id from "Company" where name='${companyBName}';`);

  // --- staff joins both companies (ダブルワーク) ---
  await adminA.goto("http://localhost:3000/company/roster");
  await adminA.click("text=＋スタッフを追加する");
  await adminA.click("text=本アカウントを招待");
  await adminA.getByRole("button", { name: "招待URLを発行する" }).click();
  await adminA.waitForSelector('input[readonly]');
  const inviteAUrl = await adminA.locator('input[readonly]').inputValue();

  await staff.goto(inviteAUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "絞込確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(/\/invite\//, { timeout: 10000 });
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff", { timeout: 10000 });
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  await adminB.goto("http://localhost:3000/company/roster");
  await adminB.click("text=＋スタッフを追加する");
  await adminB.click("text=本アカウントを招待");
  await adminB.getByRole("button", { name: "招待URLを発行する" }).click();
  await adminB.waitForSelector('input[readonly]');
  const inviteBUrl = await adminB.locator('input[readonly]').inputValue();

  await staff.goto(inviteBUrl);
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/home", { timeout: 10000 });

  const membershipCount = Number(
    psql(`select count(*) from "CompanyMembership" where "userId"='${staffUserId}';`),
  );
  log("staff has 2 memberships (ダブルワーク成立)", membershipCount === 2);

  // --- seed distinguishable data for each company ---
  seedShiftAndNotice(companyAId, staffUserId, "A社からのお知らせ");
  seedShiftAndNotice(companyBId, staffUserId, "B社からのお知らせ");
  await setupCompanyContract(adminA, companyAId, staffUserId, "A社契約業務", 1000);
  await setupCompanyContract(adminB, companyBId, staffUserId, "B社契約業務", 2000);

  // --- switch to company A: only A's data should show ---
  await switchTo(staff, companyAName);

  await staff.goto("http://localhost:3000/staff");
  let mainText = await staff.locator("main").textContent();
  log("A社アクティブ時: カレンダーにA社が表示される", mainText.includes(companyAName));
  log("A社アクティブ時: カレンダーにB社は表示されない", !mainText.includes(companyBName));
  log("A社アクティブ時: A社のお知らせが表示される", mainText.includes("A社からのお知らせ"));
  log("A社アクティブ時: B社のお知らせは表示されない", !mainText.includes("B社からのお知らせ"));

  await staff.goto("http://localhost:3000/staff/timecard");
  mainText = await staff.locator("main").textContent();
  log("A社アクティブ時: タイムカードにA社のシフトのみ", mainText.includes(companyAName) && !mainText.includes(companyBName));

  await staff.goto("http://localhost:3000/staff/contracts");
  mainText = await staff.locator("main").textContent();
  log("A社アクティブ時: 契約一覧にA社契約業務のみ", mainText.includes("A社契約業務") && !mainText.includes("B社契約業務"));

  // --- switch to company B: only B's data should show ---
  await switchTo(staff, companyBName);

  await staff.goto("http://localhost:3000/staff");
  mainText = await staff.locator("main").textContent();
  log("B社アクティブ時: カレンダーにB社が表示される", mainText.includes(companyBName));
  log("B社アクティブ時: カレンダーにA社は表示されない", !mainText.includes(companyAName));
  log("B社アクティブ時: B社のお知らせが表示される", mainText.includes("B社からのお知らせ"));
  log("B社アクティブ時: A社のお知らせは表示されない", !mainText.includes("A社からのお知らせ"));

  await staff.goto("http://localhost:3000/staff/timecard");
  mainText = await staff.locator("main").textContent();
  log("B社アクティブ時: タイムカードにB社のシフトのみ", mainText.includes(companyBName) && !mainText.includes(companyAName));

  await staff.goto("http://localhost:3000/staff/contracts");
  mainText = await staff.locator("main").textContent();
  log("B社アクティブ時: 契約一覧にB社契約業務のみ", mainText.includes("B社契約業務") && !mainText.includes("A社契約業務"));

  console.log(process.exitCode ? "MULTI-COMPANY STAFF SCOPING SMOKE TEST HAD FAILURES" : "MULTI-COMPANY STAFF SCOPING SMOKE TEST PASSED");
} catch (err) {
  console.error("MULTI-COMPANY STAFF SCOPING SMOKE TEST FAILED", err);
  await adminA.screenshot({ path: "/tmp/smoke-mcs-adminA-failure.png" });
  await adminB.screenshot({ path: "/tmp/smoke-mcs-adminB-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-mcs-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
