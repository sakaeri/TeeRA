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
const page = await browser.newPage();
const email = `dropdown-smoke-${Date.now()}@example.com`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "ドロップダウン太郎");
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", "ドロップダウンテスト株式会社");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");

  // --- staff label wording ---
  await page.goto("http://localhost:3000/company/roster");
  let bodyText = await page.textContent("body");
  log("staff tab add button now says ＋スタッフを追加する", bodyText.includes("＋スタッフを追加する"));
  log("old ＋スタッフを招待する wording is gone", !bodyText.includes("＋スタッフを招待する"));

  // --- roster add-menu closes on outside click ---
  await page.click("text=＋スタッフを追加する");
  await page.waitForTimeout(200);
  bodyText = await page.textContent("body");
  log("roster add-menu opens", bodyText.includes("本アカウントを招待") && bodyText.includes("仮アカウントを作成"));
  await page.click("h1:has-text('スタッフ名簿')");
  await page.waitForTimeout(200);
  const menuVisibleAfterOutsideClick = await page.locator("text=仮アカウントを作成").isVisible().catch(() => false);
  log("roster add-menu closes after clicking elsewhere", !menuVisibleAfterOutsideClick);

  // --- calendar FAB menu closes on outside click ---
  await page.goto("http://localhost:3000/company/calendar");
  await page.locator("button", { hasText: "＋" }).last().click();
  await page.waitForTimeout(200);
  bodyText = await page.textContent("body");
  log("calendar FAB menu opens", bodyText.includes("シフトを作成") && bodyText.includes("募集を作成"));
  await page.click("h1:has-text('シフトカレンダー')");
  await page.waitForTimeout(200);
  const fabVisibleAfterOutsideClick = await page.locator("text=募集を作成").isVisible().catch(() => false);
  log("calendar FAB menu closes after clicking elsewhere", !fabVisibleAfterOutsideClick);

  // sanity: menu still opens+works normally (didn't break the click-to-open path)
  await page.locator("button", { hasText: "＋" }).last().click();
  await page.waitForTimeout(200);
  bodyText = await page.textContent("body");
  log("calendar FAB menu re-opens normally afterward", bodyText.includes("シフトを作成"));

  console.log(process.exitCode ? "DROPDOWN OUTSIDE-CLICK SMOKE TEST HAD FAILURES" : "DROPDOWN OUTSIDE-CLICK SMOKE TEST PASSED");
} catch (err) {
  console.error("DROPDOWN OUTSIDE-CLICK SMOKE TEST FAILED", err);
  await page.screenshot({ path: "/tmp/smoke-dropdown-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}

console.log("EMAIL_FOR_CLEANUP", email);
