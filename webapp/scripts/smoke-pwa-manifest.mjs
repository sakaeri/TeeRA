import { chromium } from "playwright-core";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();

try {
  // --- 未ログインのLPでもmanifestへのリンクが出る ---
  await page.goto("http://localhost:3000/");
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  log("manifestへのlinkタグがある", manifestHref === "/manifest.webmanifest");

  const manifestRes = await page.request.get(`http://localhost:3000${manifestHref}`);
  log("manifest.webmanifestが認証無しで200で取得できる", manifestRes.status() === 200);
  const manifest = await manifestRes.json();
  log("nameが設定されている", manifest.name === "TeeRA — シフト管理");
  log("short_nameが設定されている", manifest.short_name === "TeeRA");
  log("display:standaloneが設定されている", manifest.display === "standalone");
  log("start_urlが設定されている", manifest.start_url === "/");
  log("192x192と512x512のアイコンが両方ある", manifest.icons.length === 2 && manifest.icons.some((i) => i.sizes === "192x192") && manifest.icons.some((i) => i.sizes === "512x512"));

  for (const icon of manifest.icons) {
    const iconRes = await page.request.get(`http://localhost:3000${icon.src}`);
    log(`アイコン ${icon.src} が認証無しで200で取得できる`, iconRes.status() === 200);
  }

  console.log(process.exitCode ? "PWA MANIFEST SMOKE TEST HAD FAILURES" : "PWA MANIFEST SMOKE TEST PASSED");
} catch (err) {
  console.error("PWA MANIFEST SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
