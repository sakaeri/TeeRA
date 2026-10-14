import { chromium } from "playwright-core";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

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

  await page.click("text=無料で始める");
  await page.waitForURL("http://localhost:3000/register");
  await page.fill("#name", "スモークテスト太郎");
  await page.fill("#email", email);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
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

  // マジックリンク登録のみではパスワード未設定のため、再ログイン確認の
  // 前にアカウント設定からパスワードを設定しておく。
  await page.goto("http://localhost:3000/account");
  await page.fill("#newPassword", "password123");
  await page.getByRole("button", { name: "パスワードを設定する" }).click();
  await page.getByText("パスワードを設定しました。").waitFor({ timeout: 5000 });

  await page.goto("http://localhost:3000/company");
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
