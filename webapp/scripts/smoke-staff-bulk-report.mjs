import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";
import { loginViaEmail } from "./_lib/login.mjs";

// スタッフの「業務報告」（旧タイムカード）で、前日以前の未提出をまとめて報告できる。
// 時刻は予定時刻が最初から入っていて（時間未定は空欄）、チェックを外した日は報告しない

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
const companyName = `まとめ報告株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "まとめ管理者");
  await admin.fill("#email", `bulk-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  const staffEmail = `bulk-staff-${suffix}@example.com`;
  const staffId = psql(
    `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${staffEmail}', '\\$2b\\$10\\$/mEEG3MjInUs/GTnDFsVM./2.GDR18u06dgvlLCPnc1Xz2kVQRLga', 'まとめスタッフ', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);
  const day = (n) => psql(`select to_char((now() at time zone 'Asia/Tokyo')::date - ${n}, 'YYYY-MM-DD');`);
  const mk = (date, start, end) =>
    psql(`with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", "isUndecided", status, "createdVia", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'INHOUSE', '${date}', ${start ? `'${start}'` : "null"}, ${end ? `'${end}'` : "null"}, ${start ? "false" : "true"}, 'CONFIRMED', 'ASSIGN', now()) returning id) select id from ins;`);
  const s1 = mk(day(3), "09:00", "18:00");
  const s2 = mk(day(2), "10:00", "15:00");
  const s3 = mk(day(1), null, null);
  const s4 = mk(day(4), "09:00", "18:00");
  const s5 = mk(day(5), "09:00", "18:00");

  await loginViaEmail(staff, staffEmail, "password123");
  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.waitForTimeout(1500);
  log("下のメニューの名前が「業務報告」", (await staff.getByRole("link", { name: /業務報告/ }).count()) >= 1 && (await staff.getByRole("link", { name: "タイムカード" }).count()) === 0);
  await staff.getByTestId("bulk-report-open").click();
  const modal = staff.getByTestId("bulk-report");
  const rows = modal.getByTestId("bulk-report-row");
  // 並びは古い順：5日前・4日前・3日前・2日前・昨日
  log("未提出の5件が並ぶ", (await rows.count()) === 5);
  log("予定時刻が最初から入っている（3日前 09:00〜18:00）", (await rows.nth(2).locator("input[type=time]").nth(0).inputValue()) === "09:00" && (await rows.nth(2).locator("input[type=time]").nth(1).inputValue()) === "18:00");
  log("時間未定の日は空欄で、そのままでは提出できない", (await rows.nth(4).locator("input[type=time]").nth(0).inputValue()) === "" && (await modal.getByTestId("bulk-report-submit").isDisabled()));
  // 5日前は欠勤、4日前は勤務先キャンセル（▼で選ぶと時刻欄が消える）
  await rows.nth(0).getByTestId("bulk-report-kind").selectOption("ABSENT");
  await rows.nth(1).getByTestId("bulk-report-kind").selectOption("CANCELLED_BY_EMPLOYER");
  log("欠勤を選ぶと時刻欄が消える", (await rows.nth(0).locator("input[type=time]").count()) === 0);
  // 2日前は「上の行と同じ」で 09:00〜18:00 に、休憩60分
  await rows.nth(3).getByRole("button", { name: "上の行と同じ" }).click();
  await rows.nth(3).locator("input[type=number]").fill("60");
  // 昨日は「あとで」
  await rows.nth(4).getByTestId("bulk-report-kind").selectOption("LATER");
  await staff.screenshot({ path: "/tmp/bulk-report.png" });
  log("ボタンに何をいくつ出すかが出る", (await modal.getByTestId("bulk-report-submit").innerText()).includes("出勤2件・欠勤1件・キャンセル1件を提出"));
  await modal.getByTestId("bulk-report-submit").click();
  await staff.waitForTimeout(3000);
  const rep = (id) => psql(`select coalesce(to_char(("clockIn" at time zone 'UTC') at time zone 'Asia/Tokyo', 'HH24:MI'), '') || '-' || coalesce(to_char(("clockOut" at time zone 'UTC') at time zone 'Asia/Tokyo', 'HH24:MI'), '') || '/' || coalesce("breakMinutes"::text, '') || '/' || ("submittedAt" is not null) from "WorkReport" where "shiftId"='${id}';`);
  log("3日前は予定どおり 09:00-18:00 で提出", rep(s1) === "09:00-18:00/0/true");
  log("2日前は上の行と同じ 09:00-18:00・休憩60分で提出", rep(s2) === "09:00-18:00/60/true");
  log("「あとで」の昨日は報告されずに残る", rep(s3) === "" || rep(s3).endsWith("/false"));
  const outcome = (id) => psql(`select outcome || '/' || ("submittedAt" is not null) from "WorkReport" where "shiftId"='${id}';`);
  log("5日前は欠勤として報告", outcome(s5) === "ABSENT/true");
  log("4日前は勤務先キャンセルとして報告", outcome(s4) === "CANCELLED_BY_EMPLOYER/true");

  console.log(process.exitCode ? "STAFF BULK REPORT SMOKE TEST HAD FAILURES" : "STAFF BULK REPORT SMOKE TEST PASSED");
} catch (e) {
  console.error(e);
  await staff.screenshot({ path: "/tmp/bulk-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
