import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

// 提出し忘れた過去のシフトを後日まとめて報告するケースの不具合を検証する：
// 「勤務開始/勤務終了」ボタンしか無く、押すとその場の"今日"の日付が打刻の
// 暦日として記録されてしまい、時刻だけ直しても日付がシフトの予定日と
// ズレたままになっていた。過去日のシフトは打刻ボタンを出さず、最初から
// 時刻を直接入力できるようにし、記録される日付もシフト自体の予定日を
// 基準にするよう修正した。

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(
    `PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`,
  )
    .toString()
    .split("\n")
    .filter((line) => !/^(INSERT|UPDATE|DELETE)\s/.test(line))
    .join("\n")
    .trim();
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const suffix = Date.now();
const adminEmail = `wrpast-admin-${suffix}@example.com`;
const staffEmail = `wrpast-staff-${suffix}@example.com`;
const companyName = `過去報告確認株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "過去報告確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "過去報告確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffId = psql(`select id from "User" where email='${staffEmail.toLowerCase()}';`);

  // --- ①5日前の通常シフト（打刻無し）を手入力で報告できるか ---
  const pastDateStr = psql(`select ((now() at time zone 'Asia/Tokyo')::date - 5)::text;`);
  const shiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", "taskName", status, "createdVia", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'INHOUSE', '${pastDateStr}', '09:00', '18:00', '通常業務', 'CONFIRMED', 'ASSIGN', now()) returning id) select id from ins;`,
  );

  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.waitForTimeout(400);
  const body1 = await staff.locator("body").innerText();
  log("過去シフトには「勤務開始」ボタンが出ない", !body1.includes("勤務開始"));
  log("過去シフトは最初から時刻入力欄が出る", body1.includes("出勤時刻") && body1.includes("退勤時刻"));
  log("過去シフト向けの案内文が出る", body1.includes("実際に勤務した時刻を入力してください"));

  const card = staff.locator("li", { hasText: pastDateStr }).first();
  await card.locator('input[type="time"]').first().fill("09:00");
  await card.locator('input[type="time"]').nth(1).fill("18:00");
  await staff.waitForTimeout(200);
  const submitBtn = card.getByRole("button", { name: "業務報告を提出する" });
  await submitBtn.click();
  await staff.waitForTimeout(600);

  const report1 = psql(
    `select ("clockIn" at time zone 'UTC' at time zone 'Asia/Tokyo')::date::text, ("clockOut" at time zone 'UTC' at time zone 'Asia/Tokyo')::date::text, "computedMinutes" from "WorkReport" where "shiftId"='${shiftId}';`,
  );
  const [clockInDate, clockOutDate, computedMinutes] = report1.split("|");
  log("打刻の出勤日がシフトの予定日と一致する（今日になっていない）", clockInDate === pastDateStr);
  log("打刻の退勤日もシフトの予定日と一致する", clockOutDate === pastDateStr);
  log("実働時間が9時間（540分）で正しく計算される", computedMinutes === "540");

  // --- ②深夜またぎの過去シフトも、日付をまたいで正しく記録されるか ---
  const pastDateStr2 = psql(`select ((now() at time zone 'Asia/Tokyo')::date - 6)::text;`);
  const nextDateStr2 = psql(`select ('${pastDateStr2}'::date + 1)::text;`);
  const overnightShiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", "taskName", status, "createdVia", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'INHOUSE', '${pastDateStr2}', '22:00', '06:00', '夜間業務', 'CONFIRMED', 'ASSIGN', now()) returning id) select id from ins;`,
  );

  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.waitForTimeout(400);
  const overnightCard = staff.locator("li", { hasText: pastDateStr2 }).first();
  await overnightCard.locator('input[type="time"]').first().fill("22:00");
  await overnightCard.locator('input[type="time"]').nth(1).fill("06:00");
  await staff.waitForTimeout(200);
  await overnightCard.getByRole("button", { name: "業務報告を提出する" }).click();
  await staff.waitForTimeout(600);

  const report2 = psql(
    `select ("clockIn" at time zone 'UTC' at time zone 'Asia/Tokyo')::date::text, ("clockOut" at time zone 'UTC' at time zone 'Asia/Tokyo')::date::text, "computedMinutes" from "WorkReport" where "shiftId"='${overnightShiftId}';`,
  );
  const [oClockInDate, oClockOutDate, oComputedMinutes] = report2.split("|");
  log("深夜またぎの過去シフト: 出勤日がシフトの予定日と一致する", oClockInDate === pastDateStr2);
  log("深夜またぎの過去シフト: 退勤日が翌日にずれる", oClockOutDate === nextDateStr2);
  log("深夜またぎの過去シフト: 実働時間が8時間（480分）で正しく計算される", oComputedMinutes === "480");

  console.log(process.exitCode ? "WORKREPORT PAST MANUAL ENTRY SMOKE TEST HAD FAILURES" : "WORKREPORT PAST MANUAL ENTRY SMOKE TEST PASSED");
} catch (err) {
  console.error("WORKREPORT PAST MANUAL ENTRY SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
