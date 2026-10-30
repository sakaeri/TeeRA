import { chromium } from "playwright-core";
import { readdirSync } from "node:fs";

// iPhoneでホーム画面のアイコンから開いた直後の画面（起動画面）を検証する：
// ・機種ごとの画面サイズの画像が指定されていて、その画像がすべてある
// ・画像はログインしていなくても取れる（未ログインでもアプリを開くので）

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();

try {
  await page.goto("http://localhost:3000/login");
  const hrefs = await page.locator('head link[rel="apple-touch-startup-image"]').evaluateAll((els) =>
    els.map((e) => ({ href: e.getAttribute("href"), media: e.getAttribute("media") })),
  );
  const files = readdirSync("public/splash").filter((f) => f.endsWith(".png"));
  log("起動画面の画像が13機種分指定されている", hrefs.length === 13 && hrefs.every((h) => h.media?.includes("device-width")));
  log("指定された画像がすべてpublic/splashにある", hrefs.every((h) => files.includes(h.href.replace("/splash/", ""))));
  const capable = await page.locator('head meta[name="apple-mobile-web-app-capable"]').getAttribute("content");
  log("apple-mobile-web-app-capable がある（無いとiPhoneの起動画面が出ない）", capable === "yes");
  log("iPhone 17（402×874）の画像が指定されている", hrefs.some((h) => h.href.endsWith("1206x2622.png") && h.media.includes("402px")));
  let allOk = true;
  for (const h of hrefs) {
    const res = await page.request.get(`http://localhost:3000${h.href}`, { maxRedirects: 0 });
    if (res.status() !== 200 || !res.headers()["content-type"]?.includes("image/png")) allOk = false;
  }
  log("画像はログインなしで取れる", allOk);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(process.exitCode ? "STARTUP IMAGE SMOKE TEST FAILED" : "STARTUP IMAGE SMOKE TEST PASSED");
