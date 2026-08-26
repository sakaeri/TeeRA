import { chromium } from "playwright-core";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminEmail = `conflict-admin-${Date.now()}@example.com`;
const staffEmail = `conflict-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "重複管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "重複テスト株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  await admin.click("text=スタッフ名簿");
  await admin.waitForURL("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "重複スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  // pick two future dates in the current month (same month as "today" so no
  // mini-calendar navigation is needed): dayA gets booked first, dayB stays free
  const now = new Date();
  const dayA = String(Math.min(now.getDate() + 1, 27)).padStart(2, "0");
  const dayB = String(Math.min(now.getDate() + 2, 28)).padStart(2, "0");
  const dayALabel = String(Number(dayA));
  const dayBLabel = String(Number(dayB));

  // existing shift on dayA only (via the assign wizard itself, so no team setup needed)
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  let modal = admin.locator("div.fixed.inset-0.z-20").last();
  await modal.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await modal.getByRole("button", { name: "重複スタッフ" }).click();
  await modal.getByRole("button", { name: dayALabel, exact: true }).click();
  await modal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await modal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  // second assign: select dayA (conflicting) AND dayB (free), see the warning,
  // go back, deselect dayA, go forward again -> warning must be gone
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  modal = admin.locator("div.fixed.inset-0.z-20").last();
  await modal.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await modal.getByRole("button", { name: "重複スタッフ" }).click();
  await modal.getByRole("button", { name: dayALabel, exact: true }).click();
  await modal.getByRole("button", { name: dayBLabel, exact: true }).click();
  await modal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await modal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);
  let modalBody = await admin.textContent("body");
  log(`conflict detected when day ${dayALabel} (already booked) is included`, modalBody.includes("重複している日があります"));

  await admin.click("text=＜ 戻る");
  await admin.waitForTimeout(200);
  await modal.getByRole("button", { name: dayALabel, exact: true }).click(); // deselect the conflicting date
  await modal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  modalBody = await admin.textContent("body");
  log(
    "after deselecting the conflicting date, the stale warning is gone",
    !modalBody.includes("重複している日があります"),
  );
  log(
    "create button reverts to the normal (non-override) label",
    modalBody.includes("件のシフトを作成") && !modalBody.includes("重複を確認のうえ作成する"),
  );


  console.log(process.exitCode ? "CONFLICT STALE-WARNING SMOKE TEST HAD FAILURES" : "CONFLICT STALE-WARNING SMOKE TEST PASSED");
} catch (err) {
  console.error("CONFLICT STALE-WARNING SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-conflict-stale-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
