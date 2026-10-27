import { chromium } from "playwright-core";
import { spawn } from "node:child_process";

// 電波が弱いときの表示を検証する（本番ビルドで実行する：npx next build のあと
//   node scripts/smoke-weak-signal.mjs。サーバー（ポート3100）はこのテストが起動・停止する）
// ・本文の書体をネットから読み込まない（LPの読み込みが軽くなる）
// ・左上のロゴは小さい画像
// ・ネットにつながらないとき、前回開いたページはその内容と「前回の内容を表示しています」を出す
// ・前回開いていないページは、真っ白のまま固まらずに「もう一度読み込む」画面を出す
// ・ログイン画面を開くと、保存したページの内容は消える
// sw.jsは開発中（localhost）は動かないので、別名（teera.test）でつなぐ。
// 圏外は、サーバーを止めてつながらない状態にして再現する。

const ORIGIN = "http://teera.test:3100";
function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

let server;
async function startServer() {
  server = spawn("npx", ["next", "start", "-p", "3100"], { stdio: "ignore", detached: true });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch("http://localhost:3100/sw.js")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("サーバーが起動しませんでした");
}
async function stopServer() {
  process.kill(-server.pid, "SIGTERM");
  for (let i = 0; i < 40; i++) {
    try {
      await fetch("http://localhost:3100/sw.js");
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
await startServer();

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--host-resolver-rules=MAP teera.test 127.0.0.1", `--unsafely-treat-insecure-origin-as-secure=${ORIGIN}`],
});
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true });
const page = await context.newPage();

try {
  const sizes = { font: 0, img: 0, all: 0 };
  let notoRequests = 0;
  page.on("response", async (r) => {
    try {
      const len = (await r.body()).length;
      sizes.all += len;
      if (/\.woff2/.test(r.url())) sizes.font += len;
      if (/\.(png|jpg|ico)/.test(r.url())) sizes.img += len;
    } catch {}
  });
  page.on("request", (r) => {
    if (/noto/i.test(r.url())) notoRequests++;
  });
  await page.goto(`${ORIGIN}/`, { waitUntil: "networkidle" });
  const kb = (n) => Math.round(n / 1024);
  console.log(`LPの読み込み：合計${kb(sizes.all)}KB（書体${kb(sizes.font)}KB・画像${kb(sizes.img)}KB）`);
  log("本文の書体（Noto Sans JP）をネットから読み込まない", notoRequests === 0);
  const fontDisplays = await page.evaluate(() => {
    const out = new Set();
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) if (rule instanceof CSSFontFaceRule) out.add(rule.style.getPropertyValue("font-display"));
      } catch {}
    }
    return [...out];
  });
  log("見出しの書体は届くのを待たずに表示する（font-display: optional）", fontDisplays.length > 0 && fontDisplays.every((d) => d === "optional"));
  const logo = await page.locator("header img").first().getAttribute("src");
  log("左上のロゴは小さい画像", logo === "/logo-64.png");
  const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  log("本文は端末の日本語の書体", bodyFont.includes("Hiragino Sans") && bodyFont.includes("Noto Sans CJK JP"));

  // sw.jsが有効になるのを待ってから、もう一度開いて（＝保存させて）おく
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "networkidle" });
  log("sw.jsが画面を受け持っている", await page.evaluate(() => !!navigator.serviceWorker.controller));
  await page.goto(`${ORIGIN}/login`, { waitUntil: "networkidle" });
  await page.goto(`${ORIGIN}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // --- 圏外 ---
  await stopServer();
  await page.goto(`${ORIGIN}/`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  let text = await page.locator("body").innerText();
  log("圏外でも前回開いたページ（LP）の内容が出る", text.includes("ひとつのアプリで。"));
  log("「前回開いたときの内容を表示しています」と出る", text.includes("前回開いたときの内容を表示しています"));
  const shot = process.env.WEAK_SIGNAL_SHOT_DIR;
  if (shot) await page.screenshot({ path: `${shot}/weak-copy.png` });

  await page.goto(`${ORIGIN}/register`, { waitUntil: "load" });
  text = await page.locator("body").innerText();
  log("前回開いていないページは「もう一度読み込む」画面になる", text.includes("読み込めませんでした") && text.includes("もう一度読み込む"));
  if (shot) await page.screenshot({ path: `${shot}/weak-offline.png` });

  await startServer();
  await page.getByRole("button", { name: "もう一度読み込む" }).click();
  await page.waitForTimeout(1500);
  log("電波が戻って「もう一度読み込む」を押すと開ける", (await page.locator("body").innerText()).includes("新規登録") || page.url().endsWith("/register"));

  // --- ログイン画面で保存した内容を消す ---
  await page.goto(`${ORIGIN}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const pagesLeft = await page.evaluate(async () => (await (await caches.open("teera-pages-v1")).keys()).length);
  log("ログイン画面を開くと、保存したページの内容は消える", pagesLeft === 0);

  console.log(process.exitCode ? "WEAK SIGNAL SMOKE TEST HAD FAILURES" : "WEAK SIGNAL SMOKE TEST PASSED");
} finally {
  await browser.close();
  stopServer().catch(() => {});
}
