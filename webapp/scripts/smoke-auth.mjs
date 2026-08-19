import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const page = await browser.newPage();
const email = `smoke-${Date.now()}@example.com`;

async function shot(name) {
  await page.screenshot({ path: `/tmp/smoke-${name}.png` });
}

try {
  await page.goto("http://localhost:3000/");
  console.log("landing:", page.url());
  await shot("landing");

  await page.click("text=新規登録");
  await page.waitForURL("http://localhost:3000/register");
  await page.fill("#name", "スモークテスト太郎");
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/register/company", {
    timeout: 10000,
  });
  console.log("after register:", page.url());
  await shot("after-register");

  await page.fill("#name", "スモークテスト株式会社");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company", { timeout: 10000 });
  console.log("after create company:", page.url());
  const bodyText = await page.textContent("body");
  console.log("company page contains company name:", bodyText.includes("スモークテスト株式会社"));
  await shot("company-page");

  await page.click('button[aria-label="プロフィールメニュー"]');
  await page.click("text=ログアウト");
  await page.waitForURL("http://localhost:3000/login", { timeout: 10000 });
  console.log("after logout:", page.url());

  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company", { timeout: 10000 });
  console.log("after re-login:", page.url());
  await shot("relogin-company");

  console.log("SMOKE TEST PASSED");
} catch (err) {
  console.error("SMOKE TEST FAILED", err);
  await shot("failure");
  process.exitCode = 1;
} finally {
  await browser.close();
}
