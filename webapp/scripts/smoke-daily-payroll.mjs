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

const adminEmail = `dailypay-admin-${Date.now()}@example.com`;
const staffEmail = `dailypay-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "日給管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "日給テスト株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "日給スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // DAILY-wage contract template: 日給9000円
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("日給業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("DAILY");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("9000");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);

  await staff.goto("http://localhost:3000/staff/contracts");
  await staff.getByRole("button", { name: "契約を結ぶ" }).click();
  await staff.waitForTimeout(600);

  // assign + report a shift with a LONG duration (10 hours) — if the bug were
  // still present (hours*dailyRate), this would wildly overpay; correct
  // behavior is a flat 9000円 regardless of hours worked.
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  const modal = admin.locator("div.fixed.inset-0.z-20").last();
  await modal.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await modal.getByRole("button", { name: "＋ 新しい業務内容を追加する" }).click();
  await modal.locator('input[placeholder*="業務内容"]').fill("通常業務");
  await modal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await admin.waitForTimeout(300);
  await modal.getByRole("button", { name: "日給スタッフ" }).click();
  await modal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await modal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  const shiftId = psql(`select id from "Shift" where "staffUserId"='${staffUserId}' order by "createdAt" desc limit 1;`);
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt")` +
      ` values (gen_random_uuid()::text, '${shiftId}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '10 hours', now(), 600, now(), now());`,
  );

  const thisMonth = new Date().toISOString().slice(0, 7);
  await admin.goto(`http://localhost:3000/company/payroll?month=${thisMonth}&staff=${staffUserId}`);
  await admin.waitForTimeout(500);

  const lines = JSON.parse(
    psql(
      `select json_agg(json_build_object('hours', ssl.hours, 'rate', ssl.rate, 'amount', ssl.amount)) from "SalarySlipLine" ssl join "SalarySlip" ss on ss.id = ssl."salarySlipId" where ss."staffUserId"='${staffUserId}' and ssl.kind='SHIFT';`,
    ),
  );
  const line = lines?.[0];
  log("DAILY-contract payroll line exists for the 10-hour shift", Boolean(line));
  log("DAILY-contract line: hours=1 (not 10)", line && Number(line.hours) === 1);
  log("DAILY-contract line: rate=9000", line && Number(line.rate) === 9000);
  log("DAILY-contract line: amount=9000 (flat, NOT 10h × 9000 = 90000)", line && Number(line.amount) === 9000);

  console.log(process.exitCode ? "DAILY PAYROLL SMOKE TEST HAD FAILURES" : "DAILY PAYROLL SMOKE TEST PASSED");
} catch (err) {
  console.error("DAILY PAYROLL SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-daily-payroll-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
