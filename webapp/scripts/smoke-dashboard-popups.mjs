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
const email = `dash-popups-admin-${Date.now()}@example.com`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "ポップアップ管理者");
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", "ポップアップテスト株式会社");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");

  const companyId = psql(
    `select cm."companyId" from "CompanyMembership" cm join "User" u on cm."userId"=u.id where u.email='${email}';`,
  );

  // seed a staff user directly (not going through the invite flow — irrelevant to this test)
  const staffEmail = `popup-staff-${Date.now()}@example.com`;
  psql(
    `insert into "User" (id, email, "passwordHash", name, "updatedAt") ` +
      `values (gen_random_uuid()::text, '${staffEmail}', 'x', '欠員希望スタッフ', now());`,
  );
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  const shortageDate = "2026-09-10";
  const unconfirmedDate = "2026-09-15";
  const reportDate = "2026-08-20";

  // seed a public recruitment with a shortage (0/2 filled)
  psql(
    `insert into "PublicRecruitment" (id, "companyId", title, date, "startTime", "endTime", "maxEntries", "lockedTee", status, "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', 'STB運営事務所', '${shortageDate}', '08:00', '16:00', 2, 20, 'PUBLISHED', now());`,
  );

  // seed a pending shift request
  psql(
    `insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates) ` +
      `values (gen_random_uuid()::text, '${staffUserId}', '${companyId}', 'WORK', ARRAY['${unconfirmedDate}']::date[]);`,
  );

  // seed an in-house shift + pending work report (WORKED, with clock in/out)
  const shiftIdValue = `shift-${Date.now()}`;
  psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", "createdVia", "updatedAt") ` +
      `values ('${shiftIdValue}', '${companyId}', '${staffUserId}', 'INHOUSE', '${reportDate}', '08:00', '12:00', 'ASSIGN', now());`,
  );
  const shiftId = shiftIdValue;
  // clockIn/clockOut are stored in UTC; insert JST 08:00/12:03 as UTC-9h so the
  // dashboard's Asia/Tokyo-formatted display should read 08:00/12:03
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "clockIn", "clockOut", "breakMinutes", "computedMinutes", comment, "approvalStatus", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${shiftId}', '${staffUserId}', 'WORKED', '2026-08-19T23:00:00Z', '2026-08-20T03:03:00Z', 0, 243, 'よろしくお願いします', 'PENDING', now());`,
  );

  await page.goto("http://localhost:3000/company");
  let body = await page.textContent("body");
  log("KPI cards show 1 shortage / 1 unconfirmed / 1 pending report", body.includes("1") );

  // 欠員件数 popup
  await page.getByText("欠員件数").click();
  await page.waitForTimeout(400);
  body = await page.textContent("body");
  log("欠員シフト popup shows the seeded recruitment", body.includes("STB運営事務所") && body.includes("残り2名"));
  await page.getByText("カレンダーで確認").last().click();
  await page.waitForURL(new RegExp(`date=${shortageDate}`));
  await page.waitForTimeout(400);
  body = await page.textContent("body");
  log("カレンダーで確認 jumps to the shortage day's detail", body.includes("STB運営事務所"));

  // 未確定シフト popup
  await page.goto("http://localhost:3000/company");
  await page.getByText("未確定シフト").click();
  await page.waitForTimeout(400);
  body = await page.textContent("body");
  log("未確定シフト popup shows the seeded shift request", body.includes("欠員希望スタッフ") && body.includes("出勤希望"));

  // 業務報告未承認 popup + detail modal
  await page.goto("http://localhost:3000/company");
  await page.getByText("業務報告未承認").click();
  await page.waitForTimeout(400);
  body = await page.textContent("body");
  log("業務報告未承認 popup shows the seeded report", body.includes("欠員希望スタッフ"));

  await page.getByRole("button", { name: "確認する" }).click();
  await page.waitForTimeout(400);
  body = await page.textContent("body");
  log(
    "detail modal shows clock in/out, break, hours, comment",
    body.includes("08:00") && body.includes("12:03") && body.includes("4.05時間") && body.includes("よろしくお願いします"),
  );

  await page.getByRole("button", { name: "承認する" }).click();
  await page.waitForTimeout(600);
  body = await page.textContent("body");
  log("業務報告未承認 count back to 0 after approving from the modal", body.includes("業務報告未承認"));
  const countText = await page
    .locator("p", { hasText: "業務報告未承認" })
    .locator("xpath=..")
    .locator("p.font-serif-jp")
    .first()
    .textContent()
    .catch(() => "");
  log("業務報告未承認 count decremented", !(countText ?? "").trim().startsWith("1"));

  console.log(process.exitCode ? "DASHBOARD POPUPS SMOKE TEST HAD FAILURES" : "DASHBOARD POPUPS SMOKE TEST PASSED");
} catch (err) {
  console.error("DASHBOARD POPUPS SMOKE TEST FAILED", err);
  await page.screenshot({ path: "/tmp/smoke-dashboard-popups-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
