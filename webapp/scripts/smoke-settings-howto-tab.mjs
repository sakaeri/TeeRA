import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const page = await browser.newPage();
const email = `howto-smoke-${Date.now()}@example.com`;

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "ハウツー太郎");
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", "ハウツーテスト株式会社");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");

  await page.click("text=設定");
  await page.waitForURL("http://localhost:3000/company/settings");
  await page.click("text=使い方");
  await page.waitForTimeout(800);
  const body = await page.textContent("body");
  log("permission table shown", body.includes("権限ごとに使える機能") && body.includes("チームマネージャー"));
  log("PWA instructions shown", body.includes("ホーム画面に追加する") && body.includes("iPhone"));

  console.log(process.exitCode ? "HOWTO TAB SMOKE TEST HAD FAILURES" : "HOWTO TAB SMOKE TEST PASSED");
} catch (err) {
  console.error("HOWTO TAB SMOKE TEST FAILED", err);
  await page.screenshot({ path: "/tmp/smoke-settings-howto-tab-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
