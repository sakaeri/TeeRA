import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";
import { loginViaEmail } from "./_lib/login.mjs";

// スタッフのカレンダーの「＋」で、業務報告（報告がまだのシフト・シフト外の勤務）とシフト希望を選べる

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`)
    .toString()
    .split("\n")
    .filter((line) => !/^(INSERT|UPDATE|DELETE)\s/.test(line))
    .join("\n")
    .trim();
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();
const staff = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
const suffix = Date.now();
const companyName = `プラス株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "プラス管理者");
  await admin.fill("#email", `plus-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  const staffEmail = `plus-staff-${suffix}@example.com`;
  const staffId = psql(
    `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${staffEmail}', '\\$2b\\$10\\$/mEEG3MjInUs/GTnDFsVM./2.GDR18u06dgvlLCPnc1Xz2kVQRLga', 'プラススタッフ', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);
  const yesterday = psql(`select to_char((now() at time zone 'Asia/Tokyo')::date - 1, 'YYYY-MM-DD');`);
  const shiftId = psql(`with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", status, "createdVia", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'INHOUSE', '${yesterday}', '09:00', '18:00', 'CONFIRMED', 'ASSIGN', now()) returning id) select id from ins;`);

  await loginViaEmail(staff, staffEmail, "password123");
  const openCalendar = async () => {
    await staff.goto("http://localhost:3000/staff");
    await staff.waitForTimeout(1500);
    const popup = staff.locator("div.fixed.inset-0.z-30");
    if (await popup.count()) {
      await popup.last().getByRole("button", { name: "✕" }).click().catch(() => {});
      await staff.waitForTimeout(300);
    }
  };
  await openCalendar();
  log("「＋」に報告待ちの数（1）が出る", (await staff.getByTestId("staff-plus").innerText()).includes("1"));
  await staff.getByTestId("staff-plus").click();
  const menu = staff.getByTestId("plus-menu");
  log("メニューに報告がまだのシフトが出る", (await menu.getByTestId("plus-report-shift").count()) === 1);
  await staff.screenshot({ path: "/tmp/plus-menu.png" });
  await menu.getByTestId("plus-report-shift").click();
  await staff.waitForURL(/\/staff\/timecard/);
  log("押すとタイムカードのそのシフトへ", staff.url().endsWith(`#shift-${shiftId}`));

  await openCalendar();
  await staff.getByTestId("staff-plus").click();
  await staff.getByText("シフト外で働いた日を報告する").click();
  await staff.waitForURL(/unscheduled=1/);
  await staff.waitForTimeout(1500);
  log("シフト外の勤務の報告が開いた状態で出る", (await staff.getByRole("heading", { name: "シフト外の勤務を報告" }).count()) === 1);

  await openCalendar();
  await staff.getByTestId("staff-plus").click();
  await staff.getByTestId("plus-request").click();
  const wizard = staff.locator("div.fixed.inset-0").filter({ hasText: "シフト希望申請" }).last();
  log("シフト希望の申請画面に、業務報告は別だと書いてある", (await wizard.innerText()).includes("働いた報告は「＋」の「業務報告」から"));

  console.log(process.exitCode ? "STAFF PLUS MENU SMOKE TEST HAD FAILURES" : "STAFF PLUS MENU SMOKE TEST PASSED");
} catch (e) {
  console.error(e);
  await staff.screenshot({ path: "/tmp/plus-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
