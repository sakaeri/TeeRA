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
const ctx = await browser.newContext();
const page = await ctx.newPage();
const email = `dash-todolinks-admin-${Date.now()}@example.com`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "リンク管理者");
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", "リンクテスト株式会社");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");

  const companyId = psql(
    `select cm."companyId" from "CompanyMembership" cm join "User" u on cm."userId"=u.id where u.email='${email}';`,
  );

  const staffEmail = `todolinks-staff-${Date.now()}@example.com`;
  psql(
    `insert into "User" (id, email, "passwordHash", name, "updatedAt") ` +
      `values (gen_random_uuid()::text, '${staffEmail}', 'x', 'リンクスタッフ', now());`,
  );
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);
  psql(
    `insert into "CompanyMembership" (id, "companyId", "userId", role) ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'STAFF');`,
  );

  const shortageDate = "2026-09-12";
  psql(
    `insert into "PublicRecruitment" (id, "companyId", title, date, "startTime", "endTime", "maxEntries", "lockedTee", status, "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', 'テスト事務所', '${shortageDate}', '09:00', '17:00', 1, 10, 'PUBLISHED', now());`,
  );

  const shiftId = `todolink-shift-${Date.now()}`;
  psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", "createdVia", "updatedAt") ` +
      `values ('${shiftId}', '${companyId}', '${staffUserId}', 'INHOUSE', '2026-08-20', '09:00', '13:00', 'ASSIGN', now());`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "clockIn", "clockOut", "breakMinutes", "computedMinutes", comment, "approvalStatus", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${shiftId}', '${staffUserId}', 'WORKED', '2026-08-20T00:00:00Z', '2026-08-20T04:00:00Z', 0, 240, 'テストコメント', 'PENDING', now());`,
  );
  const reportId = psql(`select id from "WorkReport" where "shiftId"='${shiftId}';`);

  // a second staff with no contract, to drive the 契約書 auto-todo item
  const contractStaffEmail = `todolinks-contract-staff-${Date.now()}@example.com`;
  psql(
    `insert into "User" (id, email, "passwordHash", name, "updatedAt") ` +
      `values (gen_random_uuid()::text, '${contractStaffEmail}', 'x', '契約書リンクスタッフ', now());`,
  );
  const contractStaffUserId = psql(`select id from "User" where email='${contractStaffEmail}';`);
  psql(
    `insert into "CompanyMembership" (id, "companyId", "userId", role) ` +
      `values (gen_random_uuid()::text, '${companyId}', '${contractStaffUserId}', 'STAFF');`,
  );

  await page.goto("http://localhost:3000/company");
  let body = await page.textContent("body");
  log(
    "業務報告 auto-todo text includes team/date/time detail",
    body.includes("リンクスタッフさんの業務（自社）（2026-08-20・09:00〜13:00）業務報告が未承認です"),
  );

  // 欠員: カレンダーで確認 should deep-link straight to that day's detail
  const shortageLink = await page
    .locator("li", { hasText: "テスト事務所" })
    .getByRole("link", { name: "カレンダーで確認" })
    .getAttribute("href");
  log("欠員 auto-todo links to the specific day", shortageLink === `/company/calendar?date=${shortageDate}`);
  await page.click(`a[href="${shortageLink}"]`);
  await page.waitForURL(new RegExp(`date=${shortageDate}`));
  await page.waitForTimeout(400);
  body = await page.textContent("body");
  log("clicking it opens that day's detail on the calendar", body.includes("テスト事務所"));

  // 業務報告: 確認する should open the report detail modal directly
  await page.goto("http://localhost:3000/company");
  await page.click(`a[href="/company?open=reports&reportId=${reportId}"]`);
  await page.waitForURL(new RegExp(`open=reports`));
  await page.waitForTimeout(400);
  body = await page.textContent("body");
  log(
    "業務報告 confirm link opens the detail modal directly (shows clock times + comment)",
    body.includes("業務報告の確認") && body.includes("09:00") && body.includes("13:00") && body.includes("テストコメント"),
  );

  // 契約書: 確認する should open the dashboard with the 契約書未確認 popup already open
  await page.goto("http://localhost:3000/company?open=contracts");
  await page.waitForTimeout(400);
  body = await page.textContent("body");
  log(
    "契約書 confirm link opens the 契約書未確認 popup directly",
    body.includes("契約書未確認") && body.includes("契約書リンクスタッフ") && body.includes("未送付"),
  );

  console.log(process.exitCode ? "DASHBOARD TODO-LINKS SMOKE TEST HAD FAILURES" : "DASHBOARD TODO-LINKS SMOKE TEST PASSED");
} catch (err) {
  console.error("DASHBOARD TODO-LINKS SMOKE TEST FAILED", err);
  await page.screenshot({ path: "/tmp/smoke-dashboard-todo-links-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
