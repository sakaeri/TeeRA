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

const adminEmail = `pw-admin-${Date.now()}@example.com`;
const staffEmail = `pw-staff-${Date.now()}@example.com`;
const today = new Date().toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "警告確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "警告確認株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='警告確認株式会社' order by "createdAt" desc limit 1;`);

  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "警告確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // 雇用契約（基本給1000円/時）を直接投入（自由選択は廃止済みのため）
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
  psql(
    `insert into "StaffContractWageVersion" (id, "staffContractId", "wageAmount", "effectiveFrom", "createdAt") ` +
      `values (gen_random_uuid()::text, '${staffContractId}', 1000, current_date - interval '7 day', now());`,
  );
  psql(`update "ContractTemplate" set status='LOCKED' where id='${templateId}';`);

  // シフト作成（業務内容「警告確認業務」— この業務内容専用のスタッフ単価は未登録）
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  const assignModal = admin.locator("div.fixed.inset-0.z-20").last();
  await assignModal.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await assignModal.getByRole("button", { name: "＋ 新しい業務内容を追加する" }).click();
  await assignModal.locator('input[placeholder*="業務内容"]').fill("警告確認業務");
  await assignModal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal.getByRole("button", { name: "警告確認スタッフ" }).click();
  await assignModal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  const shiftId = psql(`select id from "Shift" where "staffUserId"='${staffUserId}' order by "createdAt" desc limit 1;`);
  const shiftDate = psql(`select "date"::text from "Shift" where id='${shiftId}';`);

  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.getByRole("button", { name: "出勤" }).click();
  await staff.waitForTimeout(500);
  psql(`update "WorkReport" set "clockIn" = now() - interval '8 hours' where "shiftId"='${shiftId}';`);
  await staff.getByRole("button", { name: "退勤" }).click();
  await staff.waitForTimeout(500);
  await staff.getByRole("button", { name: "業務報告を提出する" }).click();
  await staff.waitForTimeout(600);

  await admin.goto("http://localhost:3000/company/settings?tab=workreports");
  await admin.getByRole("button", { name: "承認する" }).click();
  await admin.waitForTimeout(600);

  // 給与計算画面: 単価未設定の警告が出るはず（基本給1000円で計上はされる）
  await admin.goto(`http://localhost:3000/company/payroll?month=${thisMonth}&staff=${staffUserId}`);
  await admin.waitForTimeout(500);
  let body = await admin.textContent("body");
  log("warning box shown for unresolved task rate", body.includes("業務内容専用の単価が未設定") && body.includes("警告確認業務"));
  log("warning shows the shift's date", body.includes(shiftDate));

  const rateInputValue = await admin.locator("table input[type=number]").nth(1).inputValue();
  log("shift line still auto-generated at base wage (1000)", rateInputValue === "1000");

  // シフト作成時に業務内容名だけのスタブ行(StaffTaskRate)は自動生成されるが
  // （依頼主の単価タブと同じ設計）、単価バージョンはまだ0件のはず
  let taskRateVersionCount = psql(
    `select count(*) from "StaffTaskRateVersion" v join "StaffTaskRate" r on r.id=v."staffTaskRateId" ` +
      `where r."staffUserId"='${staffUserId}' and r."taskName"='警告確認業務';`,
  );
  log("no rate version exists yet for this task name (stub row only)", taskRateVersionCount === "0");

  // スタッフ詳細＞業務内容単価タブで単価を設定
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=警告確認スタッフ");
  await admin.waitForTimeout(300);
  const staffPanel = admin.locator("div.fixed.inset-0.z-30").last();
  await staffPanel.getByRole("button", { name: "業務内容単価", exact: true }).click();
  await staffPanel.getByRole("button", { name: "＋業務内容を追加" }).click();
  const newTaskFormSelect = staffPanel.locator('select').first();
  if (await newTaskFormSelect.locator('option[value="警告確認業務"]').count()) {
    await newTaskFormSelect.selectOption("警告確認業務");
  } else {
    await staffPanel.locator('input[placeholder*="業務内容"]').fill("警告確認業務");
  }
  await staffPanel.locator('input[type=number]').fill("1500");
  await staffPanel.getByRole("button", { name: "追加", exact: true }).click();
  await admin.waitForTimeout(500);

  taskRateVersionCount = psql(
    `select count(*) from "StaffTaskRateVersion" v join "StaffTaskRate" r on r.id=v."staffTaskRateId" ` +
      `where r."staffUserId"='${staffUserId}' and r."taskName"='警告確認業務';`,
  );
  log("rate version now recorded via the staff detail form", taskRateVersionCount === "1");

  // 給与計算画面を再度開く: 警告が消え、単価1500が反映されているはず
  await admin.goto(`http://localhost:3000/company/payroll?month=${thisMonth}&staff=${staffUserId}`);
  await admin.waitForTimeout(500);
  body = await admin.textContent("body");
  log("warning is gone now that the task rate is set", !body.includes("業務内容専用の単価が未設定"));

  const updatedRateInputValue = await admin.locator("table input[type=number]").nth(1).inputValue();
  log("shift line now recalculated at the new task rate (1500)", updatedRateInputValue === "1500");

  console.log(process.exitCode ? "PAYROLL UNRESOLVED-WARNING SMOKE TEST HAD FAILURES" : "PAYROLL UNRESOLVED-WARNING SMOKE TEST PASSED");
} catch (err) {
  console.error("PAYROLL UNRESOLVED-WARNING SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-payroll-unresolved-warning-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-payroll-unresolved-warning-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
