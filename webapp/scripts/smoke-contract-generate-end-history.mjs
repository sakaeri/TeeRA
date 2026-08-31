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
const admin = await (await browser.newContext()).newPage();
const staff = await (await browser.newContext()).newPage();

const adminEmail = `contract-gen-admin-${Date.now()}@example.com`;
const staffEmail = `contract-gen-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "契約管理管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "契約管理株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='契約管理株式会社';`);

  // base ACTIVE template to generate from
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("キャディ業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("DAILY");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("9000");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);

  // --- ① proxy (仮) staff: generate from StaffDetailPanel
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=仮アカウントを作成");
  await admin.locator('input[type=text]').last().fill("契約管理仮太郎");
  await admin.getByRole("button", { name: "作成" }).click();
  await admin.waitForTimeout(1500);

  await admin.reload();
  await admin.waitForTimeout(500);
  await admin.locator("tbody tr", { hasText: "契約管理仮太郎" }).click();
  await admin.waitForTimeout(300);
  const proxyPanel = admin.locator("div.fixed.inset-0.z-30").first();
  await proxyPanel.getByRole("button", { name: "契約書管理" }).click();
  await proxyPanel.getByRole("button", { name: "＋契約書を生成" }).click();
  await admin.waitForTimeout(200);
  const chooseModal = admin.locator("div.fixed.inset-0.z-30").last();
  await chooseModal.locator("select").selectOption({ label: "アルバイト・キャディ業務" });
  await chooseModal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  const assignModal = admin.locator("div.fixed.inset-0.z-30").last();
  await assignModal.getByRole("button", { name: "このテンプレートのまま契約する" }).click();
  await admin.waitForTimeout(700);

  const proxyUserId = psql(`select id from "User" where name='契約管理仮太郎';`);
  const proxyContractStatus = psql(
    `select status from "StaffContract" where "staffUserId"='${proxyUserId}' order by "createdAt" desc limit 1;`,
  );
  log("仮アカウントでもスタッフ詳細から契約書を生成できる（本人の同意待ち＝PENDING_CONSENT）", proxyContractStatus === "PENDING_CONSENT");

  // --- ② real staff: generate + end + re-generate (re-hire after gap)
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "契約管理花子");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.locator("tbody tr", { hasText: "契約管理花子" }).click();
  await admin.waitForTimeout(300);
  const panel = admin.locator("div.fixed.inset-0.z-30").first();
  await panel.getByRole("button", { name: "契約書管理" }).click();
  await panel.getByRole("button", { name: "＋契約書を生成" }).click();
  await admin.waitForTimeout(200);
  const chooseModal2 = admin.locator("div.fixed.inset-0.z-30").last();
  await chooseModal2.locator("select").selectOption({ label: "アルバイト・キャディ業務" });
  await chooseModal2.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  const assignModal2 = admin.locator("div.fixed.inset-0.z-30").last();
  await assignModal2.getByRole("button", { name: "このテンプレートのまま契約する" }).click();
  await admin.waitForTimeout(700);

  const firstContractId = psql(
    `select id from "StaffContract" where "staffUserId"='${staffUserId}' order by "createdAt" desc limit 1;`,
  );

  let panelText = await panel.textContent();
  log("契約書を生成すると現在の契約に表示される", panelText.includes("キャディ業務"));

  await panel.getByRole("button", { name: "終了する" }).click();
  await admin.waitForTimeout(200);
  const endModal = admin.locator("div.fixed.inset-0.z-40").last();
  await endModal.getByRole("button", { name: "終了する" }).click();
  await admin.waitForTimeout(600);

  const statusAfterEnd = psql(`select status from "StaffContract" where id='${firstContractId}';`);
  log("終了するを押すとENDEDになる", statusAfterEnd === "ENDED");

  const noticeGivenAtAfterEnd = psql(`select "noticeGivenAt" from "StaffContract" where id='${firstContractId}';`);
  log("終了時に本人への通知日（デフォルトは今日）が記録される", noticeGivenAtAfterEnd !== "");

  const contractEndDateAfterEnd = psql(
    `select ("contractEndDate" <= current_date) from "StaffContract" where id='${firstContractId}';`,
  );
  log("終了時に契約終了日が今日以前に更新される", contractEndDateAfterEnd === "t");

  panelText = await panel.textContent();
  log("終了後は「終了する」ボタンが無くなる（現在の契約から消える）", (await panel.getByRole("button", { name: "終了する" }).count()) === 0);
  log("過去の契約の履歴トグルが表示される", panelText.includes("過去の契約（1件）"));

  await panel.getByRole("button", { name: /過去の契約/ }).click();
  await admin.waitForTimeout(200);
  panelText = await panel.textContent();
  log("履歴を開くと終了扱いの契約が表示され「終了」ラベルになる", panelText.includes("終了") && panelText.includes("キャディ業務"));

  // re-hire after a gap: generate a NEW contract for the SAME staff/template
  await panel.getByRole("button", { name: "＋契約書を生成" }).click();
  await admin.waitForTimeout(200);
  const chooseModal3 = admin.locator("div.fixed.inset-0.z-30").last();
  await chooseModal3.locator("select").selectOption({ label: "アルバイト・キャディ業務" });
  await chooseModal3.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  const assignModal3 = admin.locator("div.fixed.inset-0.z-30").last();
  await assignModal3.getByRole("button", { name: "このテンプレートのまま契約する" }).click();
  await admin.waitForTimeout(700);

  const contractCount = psql(`select count(*) from "StaffContract" where "staffUserId"='${staffUserId}';`);
  log("期間が空いても同じテンプレートで再度契約書を生成できる（再雇用）", contractCount === "2");

  const pendingAfterRehire = psql(
    `select status from "StaffContract" where "staffUserId"='${staffUserId}' order by "createdAt" desc limit 1;`,
  );
  log("再雇用の新しい契約もまずPENDING_CONSENT（本人の同意待ち）で作られる", pendingAfterRehire === "PENDING_CONSENT");

  // 本人が同意して初めてACTIVEになる
  await staff.goto("http://localhost:3000/staff/contracts");
  await staff.waitForTimeout(500);
  await staff.getByRole("button", { name: "内容を確認しました（同意する）" }).click();
  await staff.waitForTimeout(600);

  const activeCount = psql(
    `select count(*) from "StaffContract" where "staffUserId"='${staffUserId}' and status='ACTIVE';`,
  );
  log("本人が同意すると新しい契約だけがACTIVEになる", activeCount === "1");

  // --- ③ payroll date resolution across a real contract-ended gap
  // seed an OLD (ENDED) contract covering a past period, and a NEW (ACTIVE)
  // contract covering a later period with a gap in between where NO contract
  // was active at all — confirms historical payroll isn't broken by the gap.
  const templateOldId = psql(
    `with ins as (insert into "ContractTemplate" (id, "companyId", title, "employmentType", "workplaceType", "jobDescription", "scheduleType", "wageType", "wageAmount", "contractPeriodType", "contractStartDate", "contractEndDate", status, "extraItems", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '旧契約', 'PART_TIME', 'INHOUSE', 'キャディ業務', 'FIXED', 'DAILY', 9000, 'FIXED_TERM', current_date - interval '60 day', current_date - interval '31 day', 'LOCKED', '[]', now(), now()) returning id) select id from ins;`,
  );
  const oldContractId = psql(
    `with ins as (insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", "contractStartDate", "contractEndDate", status, "consentedAt", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${templateOldId}', '${staffUserId}', 9000, current_date - interval '60 day', current_date - interval '31 day', 'ENDED', now(), now() - interval '60 day', now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "StaffContractWageVersion" (id, "staffContractId", "wageAmount", "effectiveFrom", "createdAt") ` +
      `values (gen_random_uuid()::text, '${oldContractId}', 9000, current_date - interval '60 day', now());`,
  );

  const templateNewId = psql(
    `with ins as (insert into "ContractTemplate" (id, "companyId", title, "employmentType", "workplaceType", "jobDescription", "scheduleType", "wageType", "wageAmount", "contractPeriodType", "contractStartDate", status, "extraItems", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '新契約', 'PART_TIME', 'INHOUSE', 'キャディ業務', 'FIXED', 'DAILY', 12000, 'INDEFINITE', current_date - interval '10 day', 'LOCKED', '[]', now(), now()) returning id) select id from ins;`,
  );
  const newContractId = psql(
    `with ins as (insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", "contractStartDate", status, "consentedAt", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${templateNewId}', '${staffUserId}', 12000, current_date - interval '10 day', 'ACTIVE', now(), now() - interval '10 day', now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "StaffContractWageVersion" (id, "staffContractId", "wageAmount", "effectiveFrom", "createdAt") ` +
      `values (gen_random_uuid()::text, '${newContractId}', 12000, current_date - interval '10 day', now());`,
  );

  // shift #1: 45 days ago, inside the OLD (ended) contract's period -> should bill at 9000円
  const oldShiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'INHOUSE', 'キャディ業務', current_date - interval '45 day', '09:00', '17:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${oldShiftId}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '45 day 8 hour', now() - interval '45 day', 480, now(), now());`,
  );

  // shift #2: 5 days ago, inside the NEW (active) contract's period -> should bill at 12000円
  const newShiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'INHOUSE', 'キャディ業務', current_date - interval '5 day', '09:00', '17:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${newShiftId}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '5 day 8 hour', now() - interval '5 day', 480, now(), now());`,
  );

  const oldMonth = psql(`select to_char(current_date - interval '45 day', 'YYYY-MM');`);
  const newMonth = psql(`select to_char(current_date - interval '5 day', 'YYYY-MM');`);

  await admin.goto(`http://localhost:3000/company/payroll?month=${oldMonth}&staff=${staffUserId}`);
  await admin.waitForTimeout(600);
  if (newMonth !== oldMonth) {
    await admin.goto(`http://localhost:3000/company/payroll?month=${newMonth}&staff=${staffUserId}`);
    await admin.waitForTimeout(600);
  }

  const oldLineRaw = psql(
    `select json_build_object('rate', rate, 'amount', amount) from "SalarySlipLine" ssl join "SalarySlip" ss on ss.id=ssl."salarySlipId" where ss."staffUserId"='${staffUserId}' and ssl."shiftId"='${oldShiftId}';`,
  );
  const oldLine = oldLineRaw ? JSON.parse(oldLineRaw) : null;
  log(
    "終了済みの旧契約の期間内のシフトは旧単価（日給9000円）で計算される（現在ACTIVEな契約が別にあっても影響されない）",
    oldLine && Number(oldLine.rate) === 9000 && Number(oldLine.amount) === 9000,
  );

  const newLineRaw = psql(
    `select json_build_object('rate', rate, 'amount', amount) from "SalarySlipLine" ssl join "SalarySlip" ss on ss.id=ssl."salarySlipId" where ss."staffUserId"='${staffUserId}' and ssl."shiftId"='${newShiftId}';`,
  );
  const newLine = newLineRaw ? JSON.parse(newLineRaw) : null;
  log(
    "再雇用後の新契約の期間内のシフトは新単価（日給12000円）で計算される",
    newLine && Number(newLine.rate) === 12000 && Number(newLine.amount) === 12000,
  );

  console.log(
    process.exitCode
      ? "CONTRACT GENERATE/END/HISTORY SMOKE TEST HAD FAILURES"
      : "CONTRACT GENERATE/END/HISTORY SMOKE TEST PASSED",
  );
} catch (err) {
  console.error("CONTRACT GENERATE/END/HISTORY SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-contract-gen-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-contract-gen-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
