import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// スタッフ側のカレンダーに業務報告の状態が出ることを検証する：
// ・月表示のタグが、未提出／承認待ち／承認済み／差戻し／欠勤で色分けされる
// ・打刻しただけ（未提出）のシフトも「未提出」になる（以前は報告済み扱いだった）
// ・これからのシフトは今まで通り
// ・日付の詳細に、報告した時間・状態のラベル・差戻しの理由・提出ボタンが出る

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
function dateDaysFromToday(n) {
  return new Date(Date.now() + 9 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();
const staff = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const suffix = Date.now();
const companyName = `カレンダー報告確認株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "カレンダー報告管理者");
  await admin.fill("#email", `cal-report-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  // スタッフ（パスワード "password123"。psqlはシェル経由なので$をエスケープ）
  const staffEmail = `cal-report-staff-${suffix}@example.com`;
  const staffId = psql(
    `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${staffEmail}', '\\$2b\\$10\\$/mEEG3MjInUs/GTnDFsVM./2.GDR18u06dgvlLCPnc1Xz2kVQRLga', 'カレンダー確認スタッフ', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);

  // 同じ月の中に収まる日を使う（月初・月末付近では前後の日が別の月になるため、
  // 今日から近い過去の日を、今月の範囲で選ぶ）
  const today = dateDaysFromToday(0);
  const thisMonth = today.slice(0, 7);
  const pastDays = [];
  for (let n = 1; pastDays.length < 6 && n < 40; n++) {
    const d = dateDaysFromToday(-n);
    if (d.slice(0, 7) === thisMonth) pastDays.push(d);
  }
  const shift = (date, task) =>
    psql(
      `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'INHOUSE', '${task}', '${date}', '09:00', '12:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
    );
  // 09:00〜12:00（JST）＝00:00〜03:00（UTC）
  const report = (shiftId, date, { outcome = "WORKED", approval = "PENDING", submitted = true, reason = null } = {}) =>
    psql(
      `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "submittedAt", "rejectionReason", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${shiftId}', '${staffId}', '${outcome}', '${approval}', '${date} 00:00:00', '${date} 03:00:00', 180, ${submitted ? "now()" : "null"}, ${reason ? `'${reason}'` : "null"}, now(), now());`,
    );

  const cases = {};
  if (pastDays.length >= 6) {
    cases.unsubmitted = { date: pastDays[0], id: shift(pastDays[0], "未提出業務") };
    cases.pending = { date: pastDays[1], id: shift(pastDays[1], "承認待ち業務") };
    report(cases.pending.id, pastDays[1]);
    cases.approved = { date: pastDays[2], id: shift(pastDays[2], "承認済み業務") };
    report(cases.approved.id, pastDays[2], { approval: "APPROVED" });
    cases.rejected = { date: pastDays[3], id: shift(pastDays[3], "差戻し業務") };
    report(cases.rejected.id, pastDays[3], { approval: "REJECTED", reason: "休憩時間を入れてください" });
    cases.absent = { date: pastDays[4], id: shift(pastDays[4], "欠勤業務") };
    report(cases.absent.id, pastDays[4], { outcome: "ABSENT" });
    // 打刻しただけ（提出していない）
    cases.clockedOnly = { date: pastDays[5], id: shift(pastDays[5], "打刻のみ業務") };
    report(cases.clockedOnly.id, pastDays[5], { submitted: false });
  }
  const tomorrow = dateDaysFromToday(1);
  if (tomorrow.slice(0, 7) === thisMonth) cases.future = { date: tomorrow, id: shift(tomorrow, "明日の業務") };

  // --- スタッフとしてログイン ---
  await staff.goto("http://localhost:3000/login");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000 });
  const [y, m] = thisMonth.split("-").map(Number);
  await staff.goto(`http://localhost:3000/staff?y=${y}&m=${m}`);
  await staff.waitForTimeout(1000);
  // 未提出のお知らせポップアップ（z-30）が出ていれば✕で閉じる
  const popup = staff.locator("div.fixed.inset-0.z-30");
  if (await popup.count()) {
    await popup.last().getByRole("button", { name: "✕" }).click();
    await staff.waitForTimeout(300);
  }

  const dayCell = (date) =>
    staff.locator("main button", { has: staff.locator(`span:text-is("${Number(date.slice(8, 10))}")`) }).first();
  const tagState = async (date) => (await dayCell(date).locator("[data-report-state]").first().getAttribute("data-report-state")) ?? "";

  if (pastDays.length >= 6) {
    log("報告していない過去のシフトは「未提出」", (await tagState(cases.unsubmitted.date)) === "unsubmitted");
    log("打刻しただけで提出していないシフトも「未提出」", (await tagState(cases.clockedOnly.date)) === "unsubmitted");
    log("提出して承認待ちのシフトは「承認待ち」", (await tagState(cases.pending.date)) === "pending");
    log("承認されたシフトは「承認済み」", (await tagState(cases.approved.date)) === "approved");
    log("差し戻されたシフトは「差戻し」", (await tagState(cases.rejected.date)) === "rejected");
    log("欠勤で報告したシフトは「欠勤」", (await tagState(cases.absent.date)) === "absent");
    const unsubmittedClass = (await dayCell(cases.unsubmitted.date).locator("[data-report-state]").first().getAttribute("class")) ?? "";
    log("未提出のタグはオレンジ", unsubmittedClass.includes("orange"));
    const absentClass = (await dayCell(cases.absent.date).locator("[data-report-state]").first().getAttribute("class")) ?? "";
    log("欠勤のタグはグレー＋取り消し線", absentClass.includes("gray") && absentClass.includes("line-through"));
  } else {
    console.log("SKIP 月初のため過去日のケースは省略");
  }
  if (cases.future) log("これからのシフトは今まで通り（状態なし）", (await tagState(cases.future.date)) === "none");

  // --- 日付の詳細 ---
  const openDay = async (date) => {
    await dayCell(date).click();
    await staff.waitForTimeout(300);
    return staff.locator("div.fixed.inset-0.z-20").last();
  };
  const closeDay = async (panel) => {
    await panel.getByRole("button", { name: "✕" }).click();
    await staff.waitForTimeout(200);
  };
  if (pastDays.length >= 6) {
    let panel = await openDay(cases.approved.date);
    let text = await panel.innerText();
    log("承認済みの日は報告した時間（実働・休憩つき）と「承認済み」が出る", text.includes("09:00〜12:00（実働3時間／休憩0分）") && text.includes("承認済み"));
    await closeDay(panel);

    panel = await openDay(cases.unsubmitted.date);
    text = await panel.innerText();
    const submitLink = panel.getByRole("link", { name: "業務報告を提出する" });
    log(
      "未提出の日は「未提出」と提出ボタン（タイムカードの該当シフトへ）が出る",
      text.includes("未提出") && (await submitLink.getAttribute("href")) === `/staff/timecard#shift-${cases.unsubmitted.id}`,
    );
    await closeDay(panel);

    panel = await openDay(cases.rejected.date);
    text = await panel.innerText();
    log(
      "差戻しの日は理由と出し直すボタンが出る",
      text.includes("差戻しの理由：休憩時間を入れてください") &&
        (await panel.getByRole("link", { name: "業務報告を直して出し直す" }).count()) === 1,
    );
    await closeDay(panel);

    // 提出ボタンからタイムカードの該当シフトに飛べる
    panel = await openDay(cases.unsubmitted.date);
    await panel.getByRole("link", { name: "業務報告を提出する" }).click();
    await staff.waitForURL(/\/staff\/timecard/);
    await staff.waitForTimeout(800);
    log("タイムカードに該当シフトのカードがある", (await staff.locator(`#shift-${cases.unsubmitted.id}`).count()) === 1);
  }

  console.log(process.exitCode ? "STAFF CALENDAR REPORT STATUS SMOKE TEST HAD FAILURES" : "STAFF CALENDAR REPORT STATUS SMOKE TEST PASSED");
} finally {
  await browser.close();
}
