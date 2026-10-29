import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 作成済みシフトの出勤時間を後から入力・変更できることを検証する：
// ・日別詳細の時間（「未定」など）をタップして、出勤時間を入力できる
// ・保存するとスタッフにプッシュ通知を送る（プッシュを受け取れない人にはメール）
// ・同じ日の別のシフトと時間が近い・重なる時は確認してから変更する
// ・時間を入れたら、開始前のリマインドを送り直せるようになる
// ・業務報告が提出済みのシフトは変更できない（時間の横に編集ボタンが出ない）

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
const logSize = () => readFileSync("/tmp/nextdev.log").length;
const logSince = (offset) => readFileSync("/tmp/nextdev.log").subarray(offset).toString();

const JST_OFFSET_MS = 9 * 3600e3;
const target = new Date(Date.now() + JST_OFFSET_MS + 2 * 86400e3);
const targetDate = target.toISOString().slice(0, 10);
const [ty, tm, td] = targetDate.split("-").map(Number);
const targetLabel = `${tm}月${td}日`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const suffix = Date.now();
const companyName = `時間変更確認株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "時間変更管理者");
  await admin.fill("#email", `time-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  const addStaff = (name, email) => {
    const id = psql(
      `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${email}', 'x', '${name}', now()) returning id) select id from ins;`,
    );
    psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${id}', '${companyId}', 'STAFF');`);
    return id;
  };
  const shift = (staffId, extra) =>
    psql(
      `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "reminderSentAt", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'INHOUSE', 'キャディ', '${targetDate}', ${extra}, 'CONFIRMED', 'ASSIGN', now(), now(), now()) returning id) select id from ins;`,
    );

  // プッシュを受け取れるスタッフ（届かない宛先：送ろうとすると失敗のログに宛先が出る）
  const pushStaffId = addStaff("プッシュ花子", `time-push-${suffix}@example.com`);
  const pushEndpoint = `https://push.invalid/time-${suffix}`;
  psql(
    `insert into "PushSubscription" (id, "userId", endpoint, p256dh, auth) values (gen_random_uuid()::text, '${pushStaffId}', '${pushEndpoint}', 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg');`,
  );
  const undecidedId = shift(pushStaffId, `null, null, false, true`);
  // プッシュを受け取れないスタッフ（メールで知らせる）
  const mailStaffEmail = `time-mail-${suffix}@example.com`;
  const mailStaffId = addStaff("メール太郎", mailStaffEmail);
  const mailShiftId = shift(mailStaffId, `'09:00', '15:00', false, false`);
  const mailOtherShiftId = shift(mailStaffId, `'16:00', '20:00', false, false`);
  // 業務報告を提出済みのスタッフ
  const reportedStaffId = addStaff("報告済み次郎", `time-reported-${suffix}@example.com`);
  const reportedShiftId = shift(reportedStaffId, `'09:00', '12:00', false, false`);
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "computedMinutes", "submittedAt", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${reportedShiftId}', '${reportedStaffId}', 'WORKED', 'PENDING', 180, now(), now(), now());`,
  );

  const openDay = async () => {
    await admin.goto(`http://localhost:3000/company/calendar?y=${ty}&m=${tm}`);
    await admin.waitForTimeout(800);
    await admin.locator("main button", { has: admin.locator(`span:text-is("${td}")`) }).first().click();
    await admin.waitForTimeout(400);
    return admin.locator("div.fixed.inset-0.z-20").last();
  };
  const row = (panel, name) => panel.locator("li", { hasText: name }).first();
  const editButton = (panel, name) => row(panel, name).getByTitle("出勤時間を入力・変更");

  // --- 時間未定 → 07:30〜15:00 ---
  let panel = await openDay();
  log("時間未定のシフトは時間の横に編集ボタンが出る", (await editButton(panel, "プッシュ花子").innerText()).includes("未定"));
  log("業務報告が提出済みのシフトには編集ボタンが出ない", (await editButton(panel, "報告済み次郎").count()) === 0);
  await editButton(panel, "プッシュ花子").click();
  let modal = admin.locator("div.fixed.inset-0.z-20").last();
  log("「出勤時間を入力」が開き、通知することが書いてある", (await modal.innerText()).includes("プッシュ花子さんに出勤時間をお知らせします"));
  await modal.getByText("時間を指定", { exact: true }).click();
  await modal.locator('input[type="time"]').nth(0).fill("07:30");
  await modal.locator('input[type="time"]').nth(1).fill("15:00");
  let offset = logSize();
  await modal.getByRole("button", { name: "保存して通知する" }).click();
  await admin.waitForTimeout(1500);
  const row1 = psql(
    `select coalesce("startTime",'') || '|' || coalesce("endTime",'') || '|' || "isUndecided"::text || '|' || ("reminderSentAt" is null)::text from "Shift" where id='${undecidedId}';`,
  );
  log("出勤時間が保存される（07:30〜15:00、未定ではなくなる）", row1.startsWith("07:30|15:00|false"));
  log("時間を入れたら開始前のリマインドを送り直せるようになる", row1.endsWith("|true"));
  let out = logSince(offset);
  log("プッシュを受け取れるスタッフにはプッシュ通知を送る", out.includes(pushEndpoint));
  log("プッシュを送った人にはメールは送らない", !out.includes(`宛先=time-push-${suffix}@example.com`));
  panel = admin.locator("div.fixed.inset-0.z-20").last();
  log("日別詳細の表示が新しい時間になる", (await editButton(panel, "プッシュ花子").innerText()).includes("07:30〜15:00"));

  // --- 別のシフトと重なる → 確認してから変更。プッシュがない人にはメール ---
  await editButton(panel, "メール太郎").first().click();
  modal = admin.locator("div.fixed.inset-0.z-20").last();
  await modal.locator('input[type="time"]').nth(1).fill("17:00");
  await modal.getByRole("button", { name: "保存して通知する" }).click();
  await admin.waitForTimeout(1200);
  log(
    "同じ日の別のシフトと重なる時は確認が出る（まだ変更しない）",
    (await modal.innerText()).includes("16:00〜20:00 のシフトもあり") &&
      psql(`select "endTime" from "Shift" where id='${mailShiftId}';`) === "15:00",
  );
  offset = logSize();
  await modal.getByRole("button", { name: "このまま変更して通知する" }).click();
  await admin.waitForTimeout(1500);
  out = logSince(offset);
  log(
    "確認して続けると変更され、重なる側のシフトはそのまま残る",
    psql(`select "endTime" from "Shift" where id='${mailShiftId}';`) === "17:00" &&
      psql(`select status from "Shift" where id='${mailOtherShiftId}';`) === "CONFIRMED",
  );
  log(
    "プッシュを受け取れないスタッフにはメールで知らせる（変更前と変更後の時間つき）",
    out.includes(`宛先=${mailStaffEmail} 件名=【TeeRA】出勤時間が変わりました（${tm}月${td}日`),
  );

  console.log(process.exitCode ? "SHIFT TIME CHANGE SMOKE TEST HAD FAILURES" : "SHIFT TIME CHANGE SMOKE TEST PASSED");
} finally {
  await browser.close();
}
