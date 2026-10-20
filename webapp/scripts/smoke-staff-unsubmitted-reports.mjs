import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 打刻したのに業務報告が未提出のまま溜まる問題への対策を検証する：
// ・タイムカードで「未提出の業務報告」を一番上にまとめ、今日のシフトと分ける
// ・提出済みが30件以上あっても、古い未提出が一覧から消えない
// ・退勤済みで未提出のカードを目立たせる
// ・ナビの「タイムカード」に未提出件数のバッジ
// ・ホームのポップアップに前日以前の未提出も出す（3件まで＋残りはリンク）
// ・退勤から3時間たっても未提出ならプッシュ通知を1回だけ送る

const CRON_SECRET = "local-dev-cron-secret-not-for-production";

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
const staff = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const suffix = Date.now();
const companyName = `未提出対策株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "未提出対策管理者");
  await admin.fill("#email", `unsub-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  // スタッフ（パスワード "password123"。psqlはシェル経由なので$をエスケープ）
  const staffEmail = `unsub-staff-${suffix}@example.com`;
  const staffId = psql(
    `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${staffEmail}', '\\$2b\\$10\\$/mEEG3MjInUs/GTnDFsVM./2.GDR18u06dgvlLCPnc1Xz2kVQRLga', '未提出確認スタッフ', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);

  const shift = (daysAgo, task) =>
    psql(
      `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'INHOUSE', '${task}', (now() at time zone 'Asia/Tokyo')::date - ${daysAgo}, '23:00', '23:30', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
    );
  // 今日これから勤務するシフト（未打刻）
  shift(0, "今日の予定業務");
  // 今日、退勤済みだが未提出（退勤4時間前）
  const clockedOutShift = shift(0, "退勤済み業務");
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${clockedOutShift}', '${staffId}', 'WORKED', 'PENDING', now() - interval '8 hours', now() - interval '4 hours', 240, now(), now());`,
  );
  // 前日以前の未提出（報告なし）を4件 — うち1件は50日前
  shift(2, "二日前業務");
  shift(3, "三日前業務");
  shift(4, "四日前業務");
  shift(50, "五十日前業務");
  // 提出済みを35件（以前はこれで古い未提出が一覧から押し出されていた）
  for (let i = 5; i < 40; i++) {
    const id = shift(i, `提出済み${i}`);
    psql(
      `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "computedMinutes", "submittedAt", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${id}', '${staffId}', 'WORKED', 'APPROVED', 60, now(), now(), now());`,
    );
  }

  // --- スタッフとしてログイン ---
  await staff.goto("http://localhost:3000/login");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000 });

  // --- ホームのポップアップ ---
  await staff.goto("http://localhost:3000/staff");
  await staff.waitForTimeout(1000);
  const popupText = await staff.locator("div.fixed.inset-0.z-30").last().innerText();
  log("ポップアップに前日以前の未提出も出る", popupText.includes("二日前業務") || popupText.includes(dateDaysAgo(2)));
  log("ポップアップには前日以前は3件まで＋残りはタイムカードへの案内", popupText.includes("ほかに未提出が1件あります"));

  // --- ナビのバッジ ---
  const timecardTabText = await staff.locator('nav a[href="/staff/timecard"]').first().innerText();
  log("タイムカードのタブに未提出件数（5件）のバッジ", timecardTabText.replace(/\s+/g, "") === "5タイムカード");

  // --- タイムカード ---
  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.waitForTimeout(1000);
  const sections = staff.locator("main section");
  const unsubmittedText = await sections.filter({ hasText: "未提出の業務報告" }).innerText();
  const todayText = await sections.filter({ hasText: "今日のシフト" }).innerText();
  log("未提出の見出しに件数が出る", unsubmittedText.includes("未提出の業務報告（5件）"));
  log("50日前の未提出も一覧から消えない", unsubmittedText.includes(dateDaysAgo(50)));
  log("退勤済みの未提出は未提出側に入る", unsubmittedText.includes(dateDaysAgo(0)));
  log("今日これから勤務するシフトは「今日のシフト」に分かれる", todayText.includes("勤務開始") && !todayText.includes("未提出の業務報告"));
  log("未提出のカードに提出を促す表示が出る", unsubmittedText.includes("まだ業務報告を提出していません"));

  // --- 退勤3時間後のプッシュ通知（1回だけ） ---
  const callCron = () =>
    fetch("http://localhost:3000/api/cron/notifications?job=shift-start-reminders", {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
  const res = await callCron();
  log("リマインドのジョブが動く", res.status === 200);
  const sentAt = psql(`select "submitReminderSentAt" is not null from "WorkReport" where "shiftId"='${clockedOutShift}';`);
  log("退勤から3時間を過ぎた未提出に通知を送った記録が付く", sentAt === "t");
  const firstSentAt = psql(`select "submitReminderSentAt" from "WorkReport" where "shiftId"='${clockedOutShift}';`);
  await callCron();
  log("2回目は送らない（送信記録が変わらない）", psql(`select "submitReminderSentAt" from "WorkReport" where "shiftId"='${clockedOutShift}';`) === firstSentAt);

  console.log(process.exitCode ? "STAFF UNSUBMITTED REPORTS SMOKE TEST HAD FAILURES" : "STAFF UNSUBMITTED REPORTS SMOKE TEST PASSED");
} finally {
  await browser.close();
}

function dateDaysAgo(n) {
  return new Date(Date.now() + 9 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
}
