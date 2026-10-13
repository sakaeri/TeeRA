import { chromium } from "playwright-core";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();

try {
  await page.goto("http://localhost:3000/");
  let body = await page.textContent("body");

  log("hero headline shown", body.includes("シフト管理から給与計算まで"));
  log("4 nav buttons shown (TeeRAとは？/できること見出し/はじめかた/料金プラン)", body.includes("TeeRAとは？") && body.includes("できること") && body.includes("はじめかた") && body.includes("料金プラン"));
  log("6 feature buttons shown (long descriptions NOT inlined before opening)", body.includes("スタッフ向けポイント制度") && !body.includes("業務報告の承認でポイントが貯まり"));

  // --- TeeRAとは？popup ---
  await page.getByRole("button", { name: "TeeRAとは？" }).click();
  await page.waitForTimeout(200);
  body = await page.textContent("body");
  log("「TeeRAとは？」ポップアップが開き概要文が表示される", body.includes("紙やExcelでのシフト管理が属人化していて"));
  await page.getByRole("button", { name: "閉じる" }).click();
  await page.waitForTimeout(200);
  body = await page.textContent("body");
  log("✕で閉じると概要文は消える", !body.includes("紙やExcelでのシフト管理が属人化していて"));

  // --- はじめかたpopup ---
  await page.getByRole("button", { name: "はじめかた" }).click();
  await page.waitForTimeout(200);
  body = await page.textContent("body");
  log("「はじめかた」ポップアップに3ステップが表示される", body.includes("スタッフを招待") && body.includes("シフトを作成して運用開始"));
  await page.getByRole("button", { name: "閉じる" }).click();
  await page.waitForTimeout(200);

  // --- 料金プランpopup ---
  await page.getByRole("button", { name: "料金プラン" }).click();
  await page.waitForTimeout(200);
  body = await page.textContent("body");
  log(
    "「料金プラン」ポップアップに3プランと価格が表示される",
    body.includes("無料プラン") && body.includes("スタンダード") && body.includes("ビジネス") &&
      body.includes("¥0 / 月") && body.includes("¥3,980 / 月") && body.includes("¥7,980 / 月"),
  );
  await page.getByRole("button", { name: "閉じる" }).click();
  await page.waitForTimeout(200);

  // --- 機能ボタン（給与計算）: 説明文とスクリーンショットが開く ---
  await page.getByRole("button", { name: "給与計算・給与明細発行" }).click();
  await page.waitForTimeout(200);
  body = await page.textContent("body");
  log("機能ポップアップ（給与計算）の説明文が表示される", body.includes("打刻と契約内容から給与を自動で計算"));
  const payrollShotSrc = await page.locator('img[src="/lp/payroll.png"]').getAttribute("src");
  log("機能ポップアップにスクリーンショットが表示される", payrollShotSrc === "/lp/payroll.png");
  const payrollRes = await page.request.get(`http://localhost:3000${payrollShotSrc}`);
  log(`${payrollShotSrc} loads without an auth redirect (status ${payrollRes.status()})`, payrollRes.status() === 200);
  await page.getByRole("button", { name: "閉じる" }).click();
  await page.waitForTimeout(200);

  // --- ブラウザの戻るボタンでポップアップだけ閉じ、ページ自体は離脱しない ---
  await page.getByRole("button", { name: "TeeRAとは？" }).click();
  await page.waitForTimeout(200);
  body = await page.textContent("body");
  log("戻るボタンテスト: ポップアップが開いている", body.includes("紙やExcelでのシフト管理が属人化していて"));
  await page.goBack();
  await page.waitForTimeout(200);
  log("ブラウザの戻るボタンでポップアップだけ閉じる（URLは/のまま）", page.url() === "http://localhost:3000/");
  body = await page.textContent("body");
  log("戻るボタンでポップアップの中身も消える", !body.includes("紙やExcelでのシフト管理が属人化していて"));

  // hero screenshot (always visible, not behind a popup) — the regression
  // this originally guarded: /lp/*.png must stay excluded from the auth
  // middleware for logged-out visitors (same class of bug as /icon.png once had)
  const heroShotSrc = await page.locator('img[src="/lp/calendar.png"]').getAttribute("src");
  const heroRes = await page.request.get(`http://localhost:3000${heroShotSrc}`);
  log(`${heroShotSrc} loads without an auth redirect (status ${heroRes.status()})`, heroRes.status() === 200);

  const ctaHrefs = await page.locator('a:has-text("無料で始める")').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  log("both 無料で始める CTAs link to /register", ctaHrefs.length === 2 && ctaHrefs.every((h) => h === "/register"));

  const loginHrefs = await page.locator('a:has-text("ログイン")').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  log("ログイン links point to /login", loginHrefs.length > 0 && loginHrefs.every((h) => h === "/login"));

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
  log(
    "logged-in users are redirected away from the LP (not shown the marketing page)",
    page.url() !== "http://localhost:3000/",
  );

  console.log(process.exitCode ? "LANDING PAGE SMOKE TEST HAD FAILURES" : "LANDING PAGE SMOKE TEST PASSED");
} catch (err) {
  console.error("LANDING PAGE SMOKE TEST FAILED", err);
  await page.screenshot({ path: "/tmp/smoke-landing-page-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
