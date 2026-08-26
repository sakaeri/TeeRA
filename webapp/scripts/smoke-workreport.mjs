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

const adminEmail = `wr-admin-${Date.now()}@example.com`;
const staffEmail = `wr-staff-${Date.now()}@example.com`;
const today = new Date().toISOString().slice(0, 10);

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "業務報告管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "業務報告テスト株式会社");
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
  await staff.fill("#name", "業務報告スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  // admin assigns a shift for today
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  const assignModal1 = admin.locator("div.fixed.inset-0.z-20").last();
  await assignModal1.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await assignModal1.getByRole("button", { name: "業務報告スタッフ" }).click();
  await assignModal1.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal1.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  // staff: clock in, clock out, submit report
  await staff.goto("http://localhost:3000/staff/timecard");
  let staffBody = await staff.textContent("body");
  log("staff sees today's shift", staffBody.includes(today));

  await staff.getByRole("button", { name: "出勤" }).click();
  await staff.waitForTimeout(600);
  staffBody = await staff.textContent("body");
  log("shows 退勤 button after clock-in", staffBody.includes("退勤"));

  await staff.getByRole("button", { name: "退勤" }).click();
  await staff.waitForTimeout(600);
  staffBody = await staff.textContent("body");
  log("shows submit button after clock-out", staffBody.includes("業務報告を提出する"));

  await staff.getByRole("button", { name: "業務報告を提出する" }).click();
  await staff.waitForTimeout(800);
  staffBody = await staff.textContent("body");
  log("shows 承認待ち after submit", staffBody.includes("承認待ち"));

  // admin: approve
  await admin.goto("http://localhost:3000/company/settings?tab=workreports");
  let adminBody = await admin.textContent("body");
  log("admin sees pending report", adminBody.includes("業務報告スタッフ"));

  await admin.getByRole("button", { name: "承認する" }).click();
  await admin.waitForTimeout(800);
  adminBody = await admin.textContent("body");
  log("queue empty after approval", adminBody.includes("承認待ちの業務報告はありません"));

  const pointsBalance = psql(
    `select "balanceAfter" from "StaffPointsLedgerEntry" spl join "User" u on u.id=spl."staffUserId" where u.email='${staffEmail}' order by spl."createdAt" desc limit 1;`,
  );
  log("staff earned 1 point on approval", pointsBalance === "1");

  console.log(process.exitCode ? "WORK REPORT SMOKE TEST HAD FAILURES" : "WORK REPORT SMOKE TEST PASSED");
} catch (err) {
  console.error("WORK REPORT SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-workreport-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-workreport-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
