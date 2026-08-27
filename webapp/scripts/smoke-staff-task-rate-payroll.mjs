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

const adminEmail = `stafftask-admin-${Date.now()}@example.com`;
const staffEmail = `stafftask-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "個別単価管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "個別単価株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='個別単価株式会社' order by "createdAt" desc limit 1;`);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加する");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "個別先");
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
  await staff.fill("#name", "個別単価スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // base contract: HOURLY 1500円
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("基本業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("HOURLY");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1500");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);

  await staff.goto("http://localhost:3000/staff/contracts");
  await staff.getByRole("button", { name: "契約を結ぶ" }).click();
  await staff.waitForTimeout(600);

  // a staff-specific override rate for "キャディ業務": DAILY 8000円
  // (set via スタッフ詳細＞業務内容単価 tab)
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=個別単価スタッフ");
  await admin.waitForTimeout(300);
  const staffPanel = admin.locator("div.fixed.inset-0.z-30").last();
  await staffPanel.getByRole("button", { name: "業務内容単価" }).click();
  await staffPanel.getByRole("button", { name: "＋業務内容を追加" }).click();
  await staffPanel.locator('input[placeholder*="業務内容"]').fill("キャディ業務");
  await staffPanel.locator("select").selectOption("DAILY");
  await staffPanel.locator('input[placeholder="金額"]').fill("8000");
  await staffPanel.getByRole("button", { name: "追加", exact: true }).click();
  await admin.waitForTimeout(500);
  await staffPanel.click("text=閉じる");
  await admin.waitForTimeout(200);

  const staffRateRow = JSON.parse(
    psql(`select json_agg(json_build_object('taskName',srt."taskName",'wageType',srtv."wageType",'amount',srtv.amount))->0 from "StaffTaskRate" srt join "StaffTaskRateVersion" srtv on srtv."staffTaskRateId" = srt.id where srt."staffUserId"='${staffUserId}';`),
  );
  log("StaffTaskRate created via スタッフ詳細 UI", staffRateRow && staffRateRow.taskName === "キャディ業務" && staffRateRow.wageType === "DAILY" && Number(staffRateRow.amount) === 8000);

  // shift #1: taskName has a staff-specific override -> should use DAILY 8000円 flat (8h worked)
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  let modal = admin.locator("div.fixed.inset-0.z-20").last();
  await modal.getByRole("button", { name: "個別先" }).click();
  await admin.waitForTimeout(200);
  // 依頼主側の業務内容登録（CompanyPlacementRate）とスタッフ側の単価登録
  // （StaffTaskRate）は別々のテーブルなので、taskName の文字列を一致させる
  // ため、こちらの依頼主にも同名の業務内容をその場登録する（単価は付けない）。
  await modal.getByRole("button", { name: /新しい業務内容を追加する/ }).click();
  await modal.locator('input[placeholder*="業務内容"]').fill("キャディ業務");
  await modal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await admin.waitForTimeout(400);
  await modal.getByRole("button", { name: "個別単価スタッフ" }).click();
  await modal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await modal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);
  const shift1Id = psql(`select id from "Shift" where "staffUserId"='${staffUserId}' order by "createdAt" desc limit 1;`);
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt")` +
      ` values (gen_random_uuid()::text, '${shift1Id}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '8 hours', now(), 480, now(), now());`,
  );

  // shift #2: different taskName with NO staff override -> falls back to base HOURLY 1500円 (3h worked)
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  modal = admin.locator("div.fixed.inset-0.z-20").last();
  await modal.getByRole("button", { name: "個別先" }).click();
  await admin.waitForTimeout(200);
  await modal.getByRole("button", { name: /新しい業務内容を追加する/ }).click();
  await modal.locator('input[placeholder*="業務内容"]').fill("一般作業");
  await modal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await admin.waitForTimeout(400);
  await modal.getByRole("button", { name: "個別単価スタッフ" }).click();
  // shift #1 already occupies the default 09:00〜18:00 slot today — use a
  // non-overlapping time range so this doesn't hit the conflict-check step.
  await modal.locator('input[type=time]').first().fill("19:00");
  await modal.locator('input[type=time]').nth(1).fill("21:00");
  await modal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await modal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);
  const shift2Id = psql(`select id from "Shift" where "staffUserId"='${staffUserId}' and id != '${shift1Id}' order by "createdAt" desc limit 1;`);
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt")` +
      ` values (gen_random_uuid()::text, '${shift2Id}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '3 hours', now(), 180, now(), now());`,
  );

  const thisMonth = new Date().toISOString().slice(0, 7);
  await admin.goto(`http://localhost:3000/company/payroll?month=${thisMonth}&staff=${staffUserId}`);
  await admin.waitForTimeout(500);

  const lines = JSON.parse(
    psql(
      `select json_agg(json_build_object('shiftId', ssl."shiftId", 'hours', ssl.hours, 'rate', ssl.rate, 'amount', ssl.amount)) from "SalarySlipLine" ssl join "SalarySlip" ss on ss.id = ssl."salarySlipId" where ss."staffUserId"='${staffUserId}' and ssl.kind='SHIFT';`,
    ),
  ) ?? [];
  const line1 = lines.find((l) => l.shiftId === shift1Id);
  const line2 = lines.find((l) => l.shiftId === shift2Id);

  log("shift with staff task-rate override: line exists", Boolean(line1));
  log("shift with staff task-rate override: hours=1 (DAILY flat, not ×8)", line1 && Number(line1.hours) === 1);
  log("shift with staff task-rate override: rate=8000 (overrides base 1500/h contract)", line1 && Number(line1.rate) === 8000);
  log("shift with staff task-rate override: amount=8000", line1 && Number(line1.amount) === 8000);

  log("shift with no staff override: line exists", Boolean(line2));
  log("shift with no staff override: falls back to base contract rate=1500", line2 && Number(line2.rate) === 1500);
  log("shift with no staff override: hours=3 (HOURLY, worked hours)", line2 && Number(line2.hours) === 3);
  log("shift with no staff override: amount=4500 (3h × 1500)", line2 && Number(line2.amount) === 4500);

  console.log(process.exitCode ? "STAFF TASK RATE PAYROLL SMOKE TEST HAD FAILURES" : "STAFF TASK RATE PAYROLL SMOKE TEST PASSED");
} catch (err) {
  console.error("STAFF TASK RATE PAYROLL SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-staff-task-rate-payroll-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
