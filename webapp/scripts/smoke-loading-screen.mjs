import { chromium } from "playwright-core";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// アプリを開いた直後の読み込み画面を検証する：
// ・データがそろうまでの間、ロゴの木が先に出る（真っ白にならない）
// ・メニューを切り替えたときは出ない（ヘッダー・メニューは残ったまま）
// ・iPhoneの起動画面の画像・木の画像はログインしていなくても取れる

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const suffix = Date.now();
const TREE = 'img[src="/splash/tree.webp"]';

try {
  for (const path of ["/splash/tree.webp", "/splash/apple-splash-1179x2556.png"]) {
    const res = await page.request.get(`http://localhost:3000${path}`, { maxRedirects: 0 });
    log(`${path} はログインなしで取れる`, res.status() === 200);
  }

  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "読み込み画面確認");
  await page.fill("#email", `loading-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", `読み込み画面株式会社${suffix}`);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");

  await page.waitForLoadState("networkidle");
  const inHead = await page.locator('head link[rel="apple-touch-startup-image"]').count();
  log("iPhoneの起動画面の指定が12機種分ある", inHead === 12);

  // 開いた直後：最初に届くHTMLに読み込み画面が入っている
  const html = await (await page.request.get("http://localhost:3000/company/calendar")).text();
  const treeAt = html.indexOf("/splash/tree.webp");
  log("最初に届くHTMLに木の画像が入っている", treeAt >= 0);

  // メニューの切り替えでは出ない
  await page.goto("http://localhost:3000/company");
  await page.waitForLoadState("networkidle");
  await page.evaluate((sel) => {
    window.__treeSeen = false;
    new MutationObserver(() => {
      const el = document.querySelector(sel);
      if (el && el.getBoundingClientRect().width > 0) window.__treeSeen = true;
    }).observe(document.body, { childList: true, subtree: true });
  }, TREE);
  await page.getByRole("link", { name: "カレンダー" }).first().click();
  await page.waitForURL("**/company/calendar");
  await page.waitForLoadState("networkidle");
  log("メニューの切り替えでは読み込み画面が出ない", !(await page.evaluate(() => window.__treeSeen)));

  // 読み込み画面の見た目：JavaScriptを止めると、データ到着後の差し替えが起きず読み込み画面のまま残る
  const noJs = await browser.newContext({
    viewport: { width: 390, height: 844 },
    javaScriptEnabled: false,
    storageState: await context.storageState(),
  });
  const shot = await noJs.newPage();
  await shot.goto("http://localhost:3000/company/payroll");
  log("開いた直後に木のロゴが出る", await shot.locator(TREE).isVisible());

  if (process.env.SHOT_DIR) await shot.screenshot({ path: `${process.env.SHOT_DIR}/loading-screen.png` });
  await noJs.close();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(process.exitCode ? "LOADING SCREEN SMOKE TEST FAILED" : "LOADING SCREEN SMOKE TEST PASSED");
