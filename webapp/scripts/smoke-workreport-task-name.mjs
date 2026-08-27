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

const adminEmail = `wrtask-admin-${Date.now()}@example.com`;
const staffEmail = `wrtask-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "業務内容確定管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "業務内容確定株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='業務内容確定株式会社' order by "createdAt" desc limit 1;`);

  // invite + register staff
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "確定花子");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // base HOURLY 1000円 contract
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("基本業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("HOURLY");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1000");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);
  await staff.goto("http://localhost:3000/staff/contracts");
  await staff.getByRole("button", { name: "契約を結ぶ" }).click();
  await staff.waitForTimeout(600);

  // staff-specific rate: キャディ業務 DAILY 9000円
  await admin.goto("http://localhost:3000/company/roster");
  await admin.locator("tbody tr", { hasText: "確定花子" }).click();
  await admin.waitForTimeout(300);
  const panel = admin.locator("div.fixed.inset-0.z-30").last();
  await panel.getByRole("button", { name: "業務内容単価" }).click();
  await panel.getByRole("button", { name: "＋業務内容を追加" }).click();
  await admin.waitForTimeout(150);
  await panel.locator('input[placeholder*="業務内容"]').fill("キャディ業務");
  await panel.locator("select").last().selectOption("DAILY");
  await panel.locator('input[placeholder="金額"]').fill("9000");
  await panel.getByRole("button", { name: "追加", exact: true }).click();
  await admin.waitForTimeout(500);
  await panel.click("text=閉じる");
  await admin.waitForTimeout(200);

  // shift created WITHOUT a taskName (自社/社内 shift — never gets one at creation time)
  const shiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'INHOUSE', null, current_date, '09:00', '17:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );

  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.waitForTimeout(400);
  await staff.getByRole("button", { name: "出勤" }).click();
  await staff.waitForTimeout(200);
  // backdate clockIn by 8h so computedMinutes on clockOut reflects real worked hours
  psql(`update "WorkReport" set "clockIn" = now() - interval '8 hours' where "shiftId"='${shiftId}';`);
  await staff.reload();
  await staff.waitForTimeout(400);
  await staff.getByRole("button", { name: "退勤" }).click();
  await staff.waitForTimeout(200);

  const beforeReport = psql(`select "taskName" from "WorkReport" where "shiftId"='${shiftId}';`);
  const taskNameLabel = staff.locator("label", { hasText: "業務内容" });
  log("業務報告フォームに業務内容の選択欄が表示される", (await taskNameLabel.count()) > 0);

  // pick "キャディ業務" from the picker (already known company-wide from the rate registration above)
  const picker = taskNameLabel.locator("select");
  const hasPicker = (await picker.count()) > 0;
  log("既存の業務名がピッカーとして表示される", hasPicker);
  if (hasPicker) {
    await picker.selectOption({ label: "キャディ業務" });
  }
  await staff.getByRole("button", { name: "業務報告を提出する" }).click();
  await staff.waitForTimeout(500);

  const reportTaskName = psql(`select "taskName" from "WorkReport" where "shiftId"='${shiftId}';`);
  log("WorkReport.taskNameに選び直した業務内容が保存される", reportTaskName === "キャディ業務");

  const shiftTaskName = psql(`select coalesce("taskName", '') from "Shift" where id='${shiftId}';`);
  log("Shift.taskName自体は変更されない（予定は予定のまま）", shiftTaskName === "");

  // approve
  await admin.goto("http://localhost:3000/company/settings?tab=workreports");
  await admin.waitForTimeout(400);
  let bodyText = await admin.textContent("body");
  log("承認画面に選び直した業務内容（キャディ業務）が表示される", bodyText.includes("キャディ業務"));
  await admin.getByRole("button", { name: "承認する" }).click();
  await admin.waitForTimeout(500);

  // payroll should now resolve using WorkReport.taskName (9000円 DAILY), NOT the base 1000円/h contract
  const thisMonth = new Date().toISOString().slice(0, 7);
  await admin.goto(`http://localhost:3000/company/payroll?month=${thisMonth}&staff=${staffUserId}`);
  await admin.waitForTimeout(600);

  const rawLine = psql(
    `select json_agg(json_build_object('rate', rate, 'amount', amount, 'hours', hours))->0 from "SalarySlipLine" ssl join "SalarySlip" ss on ss.id=ssl."salarySlipId" where ss."staffUserId"='${staffUserId}' and ssl."shiftId"='${shiftId}';`,
  );
  const line = rawLine ? JSON.parse(rawLine) : null;
  log(
    "自社シフトでも業務報告で選んだ業務内容（キャディ業務・日給9000円）が給与計算に反映される",
    line && Number(line.rate) === 9000 && Number(line.amount) === 9000,
  );

  console.log(process.exitCode ? "WORKREPORT TASK NAME SMOKE TEST HAD FAILURES" : "WORKREPORT TASK NAME SMOKE TEST PASSED");
} catch (err) {
  console.error("WORKREPORT TASK NAME SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-workreport-taskname-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-workreport-taskname-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
