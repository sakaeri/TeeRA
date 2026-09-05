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

// フェーズ4の検証: 同じ会社内での兼務 — 管理職が自分もシフトに入って
// 稼働するケース。CompanyMembership.canWorkShiftsフラグがONの間だけ
// /staff/*に入れて、シフト割当の選択肢にも出ることを確認する。

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();

const adminEmail = `cws-admin-${Date.now()}@example.com`;
const adminName = `兼務確認管理者${Date.now()}`;
const companyName = `兼務確認株式会社${Date.now()}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", adminName);
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const adminUserId = psql(`select id from "User" where email='${adminEmail}';`);

  // --- チェック前: /staffに入れない（会社に戻される） ---
  await admin.goto("http://localhost:3000/staff");
  await admin.waitForURL("http://localhost:3000/company", { timeout: 10000 });
  log("兼務フラグOFFの間は/staffに入れず/companyに戻される", admin.url().endsWith("/company"));

  // --- 設定画面で「このメンバーはシフトにも入れる」をON ---
  await admin.goto("http://localhost:3000/company/settings?tab=basic");
  await admin.locator("tr", { hasText: adminName }).getByRole("checkbox").check();
  await admin.waitForTimeout(400);

  const canWorkShiftsFlag = psql(
    `select "canWorkShifts" from "CompanyMembership" where "userId"='${adminUserId}';`,
  );
  log("DBのcanWorkShiftsがtrueになった", canWorkShiftsFlag === "t");

  // --- チェック後: /staffに入れる ---
  await admin.goto("http://localhost:3000/staff");
  await admin.waitForTimeout(300);
  log("兼務フラグON後は/staffに入れる（会社に戻されない）", admin.url().endsWith("/staff"));
  let mainText = await admin.locator("main").textContent();
  log("スタッフ側のシフトカレンダー画面が表示される", mainText.includes("シフトカレンダー"));

  await admin.click('button[aria-label="プロフィールメニュー"]');
  await admin.waitForTimeout(200);
  const menuText = await admin.locator('button[aria-label="プロフィールメニュー"] + div').textContent();
  log("「会社画面へ」リンクが表示される", menuText.includes("会社画面へ"));
  await admin.click("text=会社画面へ");
  await admin.waitForURL("http://localhost:3000/company", { timeout: 10000 });
  log("「会社画面へ」で会社の管理画面に戻れる（兼務は引き続きOK）", admin.url().endsWith("/company"));

  // --- シフト割当の選択肢に自分の名前が出る ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.waitForTimeout(300);
  const rosterText = await admin.locator("main").textContent();
  log("スタッフ名簿にも兼務管理者が表示される（listStaffのOR条件）", rosterText.includes(adminName));

  await admin.goto("http://localhost:3000/company/calendar");
  await admin.waitForTimeout(300);
  await admin.locator("button", { hasText: "＋" }).first().click();
  await admin.getByText("シフトを作成").click();
  await admin.waitForTimeout(300);
  const assignModal = admin.locator("div.fixed.inset-0.z-20").last();
  const hasInhouseButton = await assignModal.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).count();
  if (hasInhouseButton > 0) {
    await assignModal.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
    await assignModal.getByRole("button", { name: "＋ 新しい業務内容を追加する" }).click();
    await assignModal.locator('input[placeholder*="業務内容"]').fill("兼務確認業務");
    await assignModal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
    await admin.waitForTimeout(300);
  }
  const staffPickerText = await assignModal.textContent();
  log("シフト割当の選択肢に兼務管理者の名前が出る", staffPickerText.includes(adminName));
  await admin.keyboard.press("Escape");

  // --- 兼務フラグをOFFに戻すと、再び/staffから締め出される ---
  await admin.goto("http://localhost:3000/company/settings?tab=basic");
  await admin.locator("tr", { hasText: adminName }).getByRole("checkbox").uncheck();
  await admin.waitForTimeout(400);
  const canWorkShiftsFlagAfter = psql(
    `select "canWorkShifts" from "CompanyMembership" where "userId"='${adminUserId}';`,
  );
  log("チェックを外すとDBもfalseに戻る", canWorkShiftsFlagAfter === "f");

  await admin.goto("http://localhost:3000/staff");
  await admin.waitForURL("http://localhost:3000/company", { timeout: 10000 });
  log("兼務フラグを外すと再び/staffから締め出される", admin.url().endsWith("/company"));

  console.log(process.exitCode ? "CANWORKSHIFTS SMOKE TEST HAD FAILURES" : "CANWORKSHIFTS SMOKE TEST PASSED");
} catch (err) {
  console.error("CANWORKSHIFTS SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-canwork-shifts-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
