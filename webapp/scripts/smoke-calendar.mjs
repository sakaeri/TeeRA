import { chromium } from "playwright-core";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
admin.on("console", (msg) => console.log("[admin console]", msg.type(), msg.text()));
admin.on("pageerror", (err) => console.log("[admin pageerror]", err.message));
const adminEmail = `cal-admin-${Date.now()}@example.com`;

const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();
const staffEmail = `cal-staff-${Date.now()}@example.com`;

try {
  // --- admin: register + create company
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "カレンダー管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "カレンダーテスト株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  // --- admin: invite staff
  await admin.click("text=スタッフ名簿");
  await admin.waitForURL("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  log("got staff invite url", Boolean(inviteUrl));

  // --- staff: register via invite
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "カレンダースタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  // --- staff: submit shift request for a date
  const targetDate = "2026-09-15";
  await staff.click("text=＋シフト希望を出す");
  await staff.click("text=出勤希望");
  await staff.fill('input[type=date]', targetDate);
  await staff.click("text=追加");
  await staff.click("text=申請する");
  await staff.waitForTimeout(800);

  // --- admin: go to calendar for Sept 2026, see pending request, match it
  await admin.goto("http://localhost:3000/company/calendar?y=2026&m=9");
  let calBody = await admin.textContent("body");
  log("pending shift request visible to admin", calBody.includes("カレンダースタッフ") && calBody.includes("未確定シフト"));

  await admin.click("text=マッチさせる");
  await admin.waitForTimeout(300);
  await admin.screenshot({ path: "/tmp/smoke-calendar-pre-confirm.png" });
  await admin.getByRole("button", { name: "確定", exact: true }).click();
  await admin.waitForTimeout(1200);
  await admin.screenshot({ path: "/tmp/smoke-calendar-post-confirm.png" });

  const requestsAfterMatch = await fetch("http://localhost:3000/company/calendar?y=2026&m=9").then((r) => r.text());
  console.log("request section still shows pending list?", requestsAfterMatch.includes("未確定のシフト希望はありません"));

  // click the day cell for target date to see shift in day detail
  await admin.click(`button:has-text("15")`);
  await admin.waitForTimeout(300);
  calBody = await admin.textContent("body");
  const dayDetailMatch = calBody.match(/9月15日[\s\S]{0,200}/);
  console.log("day detail snippet:", dayDetailMatch?.[0]);
  log("matched shift appears in day detail panel", Boolean(dayDetailMatch && dayDetailMatch[0].includes("カレンダースタッフ")));

  // --- admin: create an overlapping assigned shift on same day -> expect conflict
  // (no team in this company, so the wizard starts at 勤務先 step; the day-detail
  // modal for targetDate is still open above, so its date is already selected as
  // the wizard's default date — no need to touch the mini calendar)
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  const assignModal = admin.locator("div.fixed.inset-0.z-20").last();
  await assignModal.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await assignModal.getByRole("button", { name: "カレンダースタッフ" }).click();
  await assignModal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);
  let modalBody = await admin.textContent("body");
  log("conflict detected on overlapping assign", modalBody.includes("重複している日があります"));

  await admin.getByLabel("スタッフ本人と確認済み").check();
  await admin.getByRole("button", { name: "重複を確認のうえ作成する" }).click();
  await admin.waitForTimeout(800);
  modalBody = await admin.textContent("body");
  log("override succeeded, modal closed", !modalBody.includes("重複を確認のうえ作成する"));

  console.log(process.exitCode ? "CALENDAR SMOKE TEST HAD FAILURES" : "CALENDAR SMOKE TEST PART 1 PASSED");
} catch (err) {
  console.error("CALENDAR SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-calendar-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-calendar-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
