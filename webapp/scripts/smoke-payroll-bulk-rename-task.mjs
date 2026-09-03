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

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminEmail = `pbr-admin-${Date.now()}@example.com`;
const staffEmail = `pbr-staff-${Date.now()}@example.com`;
const today = new Date().toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "表記ゆれ確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "表記ゆれ確認株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='表記ゆれ確認株式会社' order by "createdAt" desc limit 1;`);

  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "表記ゆれ確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // 雇用契約（基本給1000円/時）を直接投入
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("基本業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1000");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);
  const templateId = psql(`select id from "ContractTemplate" where "companyId"='${companyId}' order by "createdAt" desc limit 1;`);
  const staffContractId = psql(
    `with ins as (insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", "contractStartDate", status, "consentedAt", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${templateId}', '${staffUserId}', 1000, current_date - interval '7 day', 'ACTIVE', now(), now(), now()) returning id) select id from ins;`,
  );
  psql(`insert into "StaffContractWageVersion" (id, "staffContractId", "wageAmount", "effectiveFrom", "createdAt") values (gen_random_uuid()::text, '${staffContractId}', 1000, current_date - interval '7 day', now());`);
  psql(`update "ContractTemplate" set status='LOCKED' where id='${templateId}';`);

  // 正しい業務内容名「キャディ業務」であらかじめスタッフ単価(1500円/時)を登録しておく
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=表記ゆれ確認スタッフ");
  await admin.waitForTimeout(300);
  const staffPanel1 = admin.locator("div.fixed.inset-0.z-30").last();
  await staffPanel1.getByRole("button", { name: "業務内容単価", exact: true }).click();
  await staffPanel1.getByRole("button", { name: "＋業務内容を追加" }).click();
  await staffPanel1.locator('input[placeholder*="業務内容"]').fill("キャディ業務");
  await staffPanel1.locator('input[type=number]').fill("1500");
  await staffPanel1.getByRole("button", { name: "追加", exact: true }).click();
  await admin.waitForTimeout(500);

  // シフト作成時は表記ゆれの「キャディ」で入れてしまう
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  const assignModal = admin.locator("div.fixed.inset-0.z-20").last();
  await assignModal.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await assignModal.getByRole("button", { name: "＋ 新しい業務内容を追加する" }).click();
  await assignModal.locator('input[placeholder*="業務内容"]').fill("キャディ");
  await assignModal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal.getByRole("button", { name: "表記ゆれ確認スタッフ" }).click();
  await assignModal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  const shiftId = psql(`select id from "Shift" where "staffUserId"='${staffUserId}' order by "createdAt" desc limit 1;`);

  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.getByRole("button", { name: "出勤" }).click();
  await staff.waitForTimeout(500);
  psql(`update "WorkReport" set "clockIn" = now() - interval '8 hours' where "shiftId"='${shiftId}';`);
  await staff.getByRole("button", { name: "退勤" }).click();
  await staff.waitForTimeout(500);
  // 業務報告は特に選び直さず（デフォルトのままシフト予定の「キャディ」で）提出する
  await staff.getByRole("button", { name: "業務報告を提出する" }).click();
  await staff.waitForTimeout(600);

  const reportTaskName = psql(`select "taskName" from "WorkReport" where "shiftId"='${shiftId}';`);
  log("業務報告は表記ゆれの「キャディ」のまま提出された", reportTaskName === "キャディ");

  await admin.goto("http://localhost:3000/company/settings?tab=workreports");
  await admin.getByRole("button", { name: "承認する" }).click();
  await admin.waitForTimeout(600);

  // 給与計算画面: 「キャディ」≠「キャディ業務」なので警告が出て基本給(1000)のまま
  await admin.goto(`http://localhost:3000/company/payroll?month=${thisMonth}&staff=${staffUserId}`);
  await admin.waitForTimeout(500);
  let body = await admin.textContent("body");
  log("表記ゆれにより警告が出る（キャディ）", body.includes("業務内容専用の単価が未設定") && body.includes("キャディ"));
  let rateValue = await admin.locator("table input[type=number]").nth(1).inputValue();
  log("表記ゆれのため基本給(1000)のまま計算されている", rateValue === "1000");

  // 警告のチェックボックスを選んで「キャディ業務」にまとめて変更する
  const warningSection = admin.locator("section", { hasText: "業務内容専用の単価が未設定" });
  await warningSection.locator('input[type=checkbox]').first().check();
  await warningSection.getByRole("button", { name: /件の業務内容名をまとめて変更/ }).click();
  await warningSection.locator('input[type=text]').fill("キャディ業務");
  await warningSection.getByRole("button", { name: /件を変更する/ }).click();
  await admin.waitForTimeout(700);

  const updatedReportTaskName = psql(`select "taskName" from "WorkReport" where "shiftId"='${shiftId}';`);
  log("WorkReport.taskNameが「キャディ業務」に一括変更された", updatedReportTaskName === "キャディ業務");

  body = await admin.textContent("body");
  log("直した後は警告が消える", !body.includes("業務内容専用の単価が未設定"));
  rateValue = await admin.locator("table input[type=number]").nth(1).inputValue();
  log("直した後は登録済みの単価(1500)で再計算される", rateValue === "1500");

  console.log(process.exitCode ? "PAYROLL BULK-RENAME TASK NAME SMOKE TEST HAD FAILURES" : "PAYROLL BULK-RENAME TASK NAME SMOKE TEST PASSED");
} catch (err) {
  console.error("PAYROLL BULK-RENAME TASK NAME SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-payroll-bulk-rename-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-payroll-bulk-rename-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
