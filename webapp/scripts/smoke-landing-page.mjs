import { chromium } from "playwright-core";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();

try {
  await page.goto("http://localhost:3000/");
  const body = await page.textContent("body");

  log("hero headline shown", body.includes("シフト管理から給与計算まで"));
  log("pain points section shown", body.includes("こんな悩み、ありませんか？"));
  log("features section shown", body.includes("できること") && body.includes("スタッフ向けポイント制度"));
  log("steps section shown", body.includes("はじめかた") && body.includes("スタッフを招待"));
  log("pricing section shows all 3 plans", body.includes("無料プラン") && body.includes("スタンダード") && body.includes("ビジネス"));
  log("pricing shows correct prices", body.includes("¥0 / 月") && body.includes("¥3,980 / 月") && body.includes("¥7,980 / 月"));

  const ctaHrefs = await page.locator('a:has-text("無料で始める")').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  log("both 無料で始める CTAs link to /register", ctaHrefs.length === 2 && ctaHrefs.every((h) => h === "/register"));

  const loginHrefs = await page.locator('a:has-text("ログイン")').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  log("ログイン links point to /login", loginHrefs.length > 0 && loginHrefs.every((h) => h === "/login"));

  // the LP's screenshots live under /lp/*.png — this path must stay excluded
  // from the auth middleware (the same class of bug that once blocked
  // /icon.png and /apple-icon.png for logged-out visitors)
  const screenshotSrcs = await page.locator('img[src^="/lp/"]').evaluateAll((els) => els.map((e) => e.getAttribute("src")));
  log("LP has at least one /lp/*.png screenshot embedded", screenshotSrcs.length > 0);
  for (const src of screenshotSrcs) {
    const res = await page.request.get(`http://localhost:3000${src}`);
    log(`${src} loads without an auth redirect (status ${res.status()})`, res.status() === 200);
  }

  // logged-in users should still be redirected straight to /home, not see the LP
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "LPテスト管理者");
  await page.fill("#email", `lp-admin-${Date.now()}@example.com`);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", "LPテスト株式会社");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");

  await page.goto("http://localhost:3000/");
  await page.waitForURL((url) => url.pathname !== "/");
  const bodyAfterRedirect = await page.textContent("body");
  log(
    "logged-in users are redirected away from the LP (not shown the marketing page)",
    page.url() !== "http://localhost:3000/" && !bodyAfterRedirect.includes("こんな悩み、ありませんか？"),
  );

  console.log(process.exitCode ? "LANDING PAGE SMOKE TEST HAD FAILURES" : "LANDING PAGE SMOKE TEST PASSED");
} catch (err) {
  console.error("LANDING PAGE SMOKE TEST FAILED", err);
  await page.screenshot({ path: "/tmp/smoke-landing-page-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
