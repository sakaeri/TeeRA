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
function addDays(dateStr, delta) {
  const d = new Date(dateStr + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminEmail = `staffratever-admin-${Date.now()}@example.com`;
const staffEmail = `staffratever-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "スタッフ履歴管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "スタッフ履歴株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='スタッフ履歴株式会社' order by "createdAt" desc limit 1;`);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加する");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "スタッフ履歴先");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);
  const relId = psql(`select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' order by "createdAt" desc limit 1;`);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "履歴給与スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // base HOURLY 1500円 contract (fallback baseline)
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("基本業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("HOURLY");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1500");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);

  // スタッフの自由選択は廃止済み（契約書は管理者が用意し本人が同意する形）
  // なので、このテストの本題（単価改定履歴の日付解決）とは無関係な契約締結
  // 手順はUIを通さず直接ACTIVEな契約として投入する。
  // 契約開始日はテンプレートのcontractStartDate（UI側でtodayJst()由来）に
  // 合わせず、確実に過去日にしておく — 実行タイミング次第でJSTとUTCの「今日」
  // がずれる時間帯があり、テンプレートの日付をそのまま使うとシフト日付が
  // 契約開始日より前と判定されてしまうことがあるため。
  const baseTemplateId = psql(`select id from "ContractTemplate" where "companyId"='${companyId}' order by "createdAt" desc limit 1;`);
  const baseWageAmount = psql(`select "wageAmount" from "ContractTemplate" where id='${baseTemplateId}';`);
  const baseStaffContractId = psql(
    `with ins as (insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", "contractStartDate", status, "consentedAt", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${baseTemplateId}', '${staffUserId}', ${baseWageAmount}, current_date - interval '7 day', 'ACTIVE', now(), now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "StaffContractWageVersion" (id, "staffContractId", "wageAmount", "effectiveFrom", "createdAt") ` +
      `values (gen_random_uuid()::text, '${baseStaffContractId}', ${baseWageAmount}, current_date - interval '7 day', now());`,
  );
  psql(`update "ContractTemplate" set status='LOCKED' where id='${baseTemplateId}';`);

  const today = psql(`select to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM-DD');`);
  const oldShiftDate = addDays(today, -10);
  const newShiftDate = addDays(today, 1);

  // register a per-task override rate: DAILY 6000円, effective from 30 days ago
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=履歴給与スタッフ");
  await admin.waitForTimeout(300);
  const panel = admin.locator("div.fixed.inset-0.z-30").last();
  await panel.getByRole("button", { name: "業務内容単価" }).click();
  await panel.getByRole("button", { name: "＋業務内容を追加" }).click();
  await panel.locator('input[placeholder*="業務内容"]').fill("特殊作業");
  await panel.locator("select").nth(1).selectOption("DAILY");
  await panel.locator('input[placeholder="金額"]').fill("6000");
  await panel.locator('input[type=date]').fill(addDays(today, -30));
  await panel.getByRole("button", { name: "追加", exact: true }).click();
  await admin.waitForTimeout(500);

  const staffTaskRateId = psql(`select id from "StaffTaskRate" where "taskName"='特殊作業' and "staffUserId"='${staffUserId}';`);
  log("staff task rate registered", Boolean(staffTaskRateId));

  // amend it to 9000円 effective TODAY
  await panel.getByRole("button", { name: "単価を変更" }).click();
  await panel.locator("select").selectOption("DAILY");
  await panel.locator('input[type=number]').fill("9000");
  await panel.locator('input[type=date]').fill(today);
  await panel.getByRole("button", { name: "保存" }).click();
  await admin.waitForTimeout(500);

  const versionCount = psql(`select count(*) from "StaffTaskRateVersion" where "staffTaskRateId"='${staffTaskRateId}';`);
  log("two versions exist for the staff task rate (history preserved)", versionCount === "2");
  await panel.click("text=閉じる");
  await admin.waitForTimeout(200);

  // shift #1 (client-workplace, taskName=特殊作業) dated 10 days ago -> OLD rate (6000円)
  const oldShiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'CLIENT', '${relId}', '特殊作業', '${oldShiftDate}', '09:00', '17:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt")` +
      ` values (gen_random_uuid()::text, '${oldShiftId}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '8 hours', now(), 480, now(), now());`,
  );

  // shift #2 dated tomorrow -> NEW rate (9000円)
  const newShiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'CLIENT', '${relId}', '特殊作業', '${newShiftDate}', '09:00', '17:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt")` +
      ` values (gen_random_uuid()::text, '${newShiftId}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '8 hours', now(), 480, now(), now());`,
  );

  const oldMonth = oldShiftDate.slice(0, 7);
  await admin.goto(`http://localhost:3000/company/payroll?month=${oldMonth}&staff=${staffUserId}`);
  await admin.waitForTimeout(500);
  const oldLine = JSON.parse(
    psql(`select json_agg(json_build_object('rate',rate,'hours',hours,'amount',amount))->0 from "SalarySlipLine" ssl join "SalarySlip" ss on ss.id=ssl."salarySlipId" where ss."staffUserId"='${staffUserId}' and ssl."shiftId"='${oldShiftId}';`),
  );
  log("shift before the rate change pays at the OLD rate (6000円 flat, DAILY)", oldLine && Number(oldLine.rate) === 6000 && Number(oldLine.hours) === 1 && Number(oldLine.amount) === 6000);

  const newMonth = newShiftDate.slice(0, 7);
  await admin.goto(`http://localhost:3000/company/payroll?month=${newMonth}&staff=${staffUserId}`);
  await admin.waitForTimeout(500);
  const newLine = JSON.parse(
    psql(`select json_agg(json_build_object('rate',rate,'hours',hours,'amount',amount))->0 from "SalarySlipLine" ssl join "SalarySlip" ss on ss.id=ssl."salarySlipId" where ss."staffUserId"='${staffUserId}' and ssl."shiftId"='${newShiftId}';`),
  );
  log("shift after the rate change pays at the NEW rate (9000円 flat, DAILY)", newLine && Number(newLine.rate) === 9000 && Number(newLine.hours) === 1 && Number(newLine.amount) === 9000);

  // "終了する" is gone — a rate that has already been used by an approved
  // shift can no longer be deleted either (history must stay intact).
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=履歴給与スタッフ");
  await admin.waitForTimeout(300);
  const panel2 = admin.locator("div.fixed.inset-0.z-30").last();
  await panel2.getByRole("button", { name: "業務内容単価" }).click();
  log("終了するボタンは廃止されている", (await panel2.getByRole("button", { name: "終了する" }).count()) === 0);
  await panel2.getByRole("button", { name: "削除", exact: true }).click();
  await admin.waitForTimeout(200);
  await admin.locator("div.fixed.inset-0.z-40").last().getByRole("button", { name: "削除する" }).click();
  await admin.waitForTimeout(400);
  const panelTextAfterDeleteAttempt = await panel2.textContent();
  log(
    "使用済みの単価は削除できず、エラーメッセージが表示される",
    panelTextAfterDeleteAttempt.includes("使用されているため削除できません"),
  );
  const stillExistsCount = psql(`select count(*) from "StaffTaskRate" where id='${staffTaskRateId}';`);
  log("使用済みの単価は削除されず残っている", stillExistsCount === "1");

  // a never-used task rate CAN be deleted outright.
  await panel2.getByRole("button", { name: "＋業務内容を追加" }).click();
  await admin.waitForTimeout(150);
  if ((await panel2.locator('input[placeholder*="業務内容"]').count()) === 0) {
    await panel2.locator("select").first().selectOption({ label: "＋ 新しい業務内容を追加する" });
  }
  await panel2.locator('input[placeholder*="業務内容"]').fill("未使用業務");
  await panel2.locator("select").last().selectOption("HOURLY");
  await panel2.locator('input[placeholder="金額"]').fill("1200");
  await panel2.getByRole("button", { name: "追加", exact: true }).click();
  await admin.waitForTimeout(500);
  const unusedRateId = psql(`select id from "StaffTaskRate" where "taskName"='未使用業務' and "staffUserId"='${staffUserId}';`);
  await panel2.locator("li", { hasText: "未使用業務" }).getByRole("button", { name: "削除" }).click();
  await admin.waitForTimeout(200);
  await admin.locator("div.fixed.inset-0.z-40").last().getByRole("button", { name: "削除する" }).click();
  await admin.waitForTimeout(400);
  const unusedStillExists = psql(`select count(*) from "StaffTaskRate" where id='${unusedRateId}';`);
  log("未使用の単価は削除できる", unusedStillExists === "0");

  console.log(process.exitCode ? "STAFF RATE VERSIONING SMOKE TEST HAD FAILURES" : "STAFF RATE VERSIONING SMOKE TEST PASSED");
} catch (err) {
  console.error("STAFF RATE VERSIONING SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-staff-rate-versioning-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
