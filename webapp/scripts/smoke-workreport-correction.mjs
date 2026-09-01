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
const admin = await (await browser.newContext()).newPage();
const staff = await (await browser.newContext()).newPage();

const adminEmail = `wr-correct-admin-${Date.now()}@example.com`;
const staffEmail = `wr-correct-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "修正確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "修正確認株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='修正確認株式会社' order by "createdAt" desc limit 1;`);

  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "修正確認太郎");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // seed a shift + PENDING work report directly with controlled clock times:
  // 09:00〜17:00 JST (=00:00〜08:00 UTC), no break entered (staff forgot to
  // log break time — the exact scenario being tested), 8h = 480min computed.
  const shiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'INHOUSE', '通常業務', current_date, '09:00', '17:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  const reportId = psql(
    `with ins as (insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "breakMinutes", "computedMinutes", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${shiftId}', '${staffUserId}', 'WORKED', 'PENDING', current_date + interval '0 hour', current_date + interval '8 hour', 0, 480, now(), now()) returning id) select id from ins;`,
  );

  // admin: correct (add the 60-minute break the staff forgot) and return
  await admin.goto("http://localhost:3000/company/settings?tab=workreports");
  let adminBody = await admin.textContent("body");
  log("管理者に承認待ちの報告が見える", adminBody.includes("修正確認太郎"));

  await admin.getByRole("button", { name: "修正して差し戻す" }).click();
  await admin.waitForTimeout(200);
  const popup = admin.locator("div.fixed.inset-0.z-40").last();
  const clockInInput = popup.locator("label", { hasText: "出勤時刻" }).locator("input");
  const clockOutInput = popup.locator("label", { hasText: "退勤時刻" }).locator("input");
  const breakInput = popup.locator("label", { hasText: "休憩" }).locator("input");
  const originalClockIn = await clockInInput.inputValue();
  const originalClockOut = await clockOutInput.inputValue();
  log("修正ポップアップに元の打刻時刻(09:00〜17:00)が入っている", originalClockIn === "09:00" && originalClockOut === "17:00");

  await breakInput.fill("60");
  await popup.getByRole("button", { name: "保存" }).click();
  await admin.waitForTimeout(600);

  const afterCorrect = psql(
    `select "approvalStatus", "breakMinutes", "computedMinutes", "correctedByUserId" from "WorkReport" where id='${reportId}';`,
  );
  const [statusAfterCorrect, breakAfter, minutesAfter, correctedBy] = afterCorrect.split("|");
  log("修正後はNEEDS_CONFIRMATIONになる（企業は直接承認できない）", statusAfterCorrect === "NEEDS_CONFIRMATION");
  log("休憩時間が60分に修正される", breakAfter === "60");
  log("実働時間が休憩60分ぶん再計算される（480→420分）", minutesAfter === "420");
  log("修正した管理者のユーザーIDが記録される", !!correctedBy);

  adminBody = await admin.textContent("body");
  log("修正後は承認待ちキューから消える（スタッフの確認待ちに移る）", adminBody.includes("承認待ちの業務報告はありません"));

  await staff.goto("http://localhost:3000/staff/timecard");
  let staffBody = await staff.textContent("body");
  log("スタッフに修正内容の確認依頼が表示される", staffBody.includes("企業が打刻内容を修正しました"));
  log("スタッフに休憩60分・実働7.0時間の表示が見える", staffBody.includes("休憩60分") && staffBody.includes("7.0"));

  await staff.getByRole("button", { name: "これで合っています" }).click();
  await staff.waitForTimeout(600);

  const afterConfirm = psql(`select "approvalStatus", "approverUserId" from "WorkReport" where id='${reportId}';`);
  const [statusAfterConfirm, approverAfterConfirm] = afterConfirm.split("|");
  log("スタッフ確認後はAPPROVEDになる", statusAfterConfirm === "APPROVED");
  log("承認者IDは修正した管理者のまま引き継がれる", approverAfterConfirm === correctedBy);

  const pointsBalance = psql(
    `select "balanceAfter" from "StaffPointsLedgerEntry" where "staffUserId"='${staffUserId}' order by "createdAt" desc limit 1;`,
  );
  log("確認完了時にポイントが付与される", pointsBalance === "1");

  // (a) 稼働履歴タブの集計はAPPROVEDのみを数える確認 — 別途PENDINGの
  // シフトを1件足し、その分（3h）は稼働時間・出勤日数に含まれないことを見る
  const shift2Id = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'INHOUSE', '通常業務', current_date, '18:00', '21:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "breakMinutes", "computedMinutes", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${shift2Id}', '${staffUserId}', 'WORKED', 'PENDING', current_date + interval '9 hour', current_date + interval '12 hour', 0, 180, now(), now());`,
  );

  await admin.goto("http://localhost:3000/company/roster");
  await admin.locator("tbody tr", { hasText: "修正確認太郎" }).click();
  await admin.waitForTimeout(400);
  const panel = admin.locator("div.fixed.inset-0.z-30").last();
  const panelText = await panel.textContent();
  log(
    "稼働時間はAPPROVEDの1件（7h）のみを数え、PENDING分の3hは含まれない",
    panelText.includes("7h") && !panelText.includes("10h"),
  );
  log("出勤日数はAPPROVEDの1日のみ", panelText.includes("1日"));

  console.log(process.exitCode ? "WORK REPORT CORRECTION SMOKE TEST HAD FAILURES" : "WORK REPORT CORRECTION SMOKE TEST PASSED");
} catch (err) {
  console.error("WORK REPORT CORRECTION SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-workreport-correction-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-workreport-correction-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
