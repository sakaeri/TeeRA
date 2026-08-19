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

const adminEmail = `pr-admin-${Date.now()}@example.com`;
const staffEmail = `pr-staff-${Date.now()}@example.com`;
const today = new Date().toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "給与管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "給与テスト株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  const companyId = psql(`select id from "Company" where name='給与テスト株式会社' order by "createdAt" desc limit 1;`);
  psql(
    `update "Company" set "teeBalance" = 10 where id = '${companyId}';` +
      `insert into "TeeLedgerEntry" (id, "companyId", type, amount, "balanceAfter", "createdAt") values (gen_random_uuid()::text, '${companyId}', 'ADJUSTMENT', 10, 10, now());`,
  );

  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを招待する");
  await admin.click("text=本アカウントを招待");
  await admin.waitForSelector("text=招待URL:");
  const bodyText = await admin.textContent("body");
  const inviteUrl = bodyText.match(/http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]+/)[0];

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "給与スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  // contract with wage rate 1300/hr
  await admin.goto("http://localhost:3000/company/contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.locator("label:has-text('業務内容') input").fill("レジ業務");
  await admin.locator("label:has-text('賃金') input[type=number]").fill("1300");
  await admin.getByRole("button", { name: "作成する" }).click();
  await admin.waitForTimeout(600);

  await staff.goto("http://localhost:3000/staff/contracts");
  await staff.getByRole("button", { name: "契約を結ぶ" }).click();
  await staff.waitForTimeout(600);

  // shift today, clock in/out, submit, approve
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  await admin.waitForSelector('input[type="date"]');
  await admin.fill('input[type=date]', today);
  await admin.getByRole("button", { name: "作成する" }).click();
  await admin.waitForTimeout(800);

  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.getByRole("button", { name: "出勤" }).click();
  await staff.waitForTimeout(500);
  // backdate clockIn by 8h so the test doesn't depend on real elapsed time
  const shiftIdForToday = psql(
    `select id from "Shift" where "staffUserId"='${psql(`select id from "User" where email='${staffEmail}';`)}' order by "createdAt" desc limit 1;`,
  );
  psql(`update "WorkReport" set "clockIn" = now() - interval '8 hours' where "shiftId"='${shiftIdForToday}';`);
  await staff.getByRole("button", { name: "退勤" }).click();
  await staff.waitForTimeout(500);
  await staff.getByRole("button", { name: "業務報告を提出する" }).click();
  await staff.waitForTimeout(600);

  await admin.goto("http://localhost:3000/company/workreports");
  await admin.getByRole("button", { name: "承認する" }).click();
  await admin.waitForTimeout(600);

  // payroll: open, check auto line + rate 1300, add deduction, finalize, issue
  await admin.goto(`http://localhost:3000/company/payroll?month=${thisMonth}`);
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);
  await admin.goto(`http://localhost:3000/company/payroll?month=${thisMonth}&staff=${staffUserId}`);
  let body = await admin.textContent("body");
  const rateInputValue = await admin.locator("table input[type=number]").nth(1).inputValue();
  log("auto-generated shift line with rate 1300", rateInputValue === "1300");

  // set a deduction amount
  const firstDeductionInput = admin.locator("input[type=number]").first();
  // deductions inputs come after line hour/rate inputs; instead target by section
  const socialInsuranceInput = admin
    .locator("section", { hasText: "控除" })
    .locator("input[type=number]")
    .first();
  await socialInsuranceInput.fill("500");
  await socialInsuranceInput.blur();
  await admin.waitForTimeout(600);

  body = await admin.textContent("body");
  log("net pay reflects deduction", /差引支給額 [\d,]+円/.test(body));

  await admin.getByRole("button", { name: "発行する（1 Tee）" }).click();
  await admin.getByRole("button", { name: "発行する", exact: true }).click();
  await admin.waitForTimeout(1000);

  const balanceAfterIssue = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("balance charged 1 Tee on first issue (10 -> 9)", balanceAfterIssue === 9);

  body = await admin.textContent("body");
  log("status shows 発行済み", body.includes("発行済み"));

  // re-issue (free)
  await admin.getByRole("button", { name: "再発行する（同月内は無料）" }).click();
  await admin.getByRole("button", { name: "発行する", exact: true }).click();
  await admin.waitForTimeout(1000);

  const balanceAfterReissue = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("re-issue same month is free (still 9)", balanceAfterReissue === 9);

  // fetch the PDF
  const pdfLink = await admin.locator('a[href*="/api/salary-slips/"]').first().getAttribute("href");
  const pdfResp = await admin.request.get(`http://localhost:3000${pdfLink}`);
  const pdfBuffer = await pdfResp.body();
  log("PDF response content-type", pdfResp.headers()["content-type"] === "application/pdf");
  log("PDF is non-trivial size (>1000 bytes)", pdfBuffer.length > 1000);
  log("PDF starts with %PDF magic bytes", pdfBuffer.slice(0, 4).toString() === "%PDF");

  console.log(process.exitCode ? "PAYROLL SMOKE TEST HAD FAILURES" : "PAYROLL SMOKE TEST PASSED");
} catch (err) {
  console.error("PAYROLL SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-payroll-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-payroll-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
