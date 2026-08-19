import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("/tmp/proto", { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

let shotN = 0;
async function shot(name, fullPage = false) {
  shotN += 1;
  const path = `/tmp/proto/${String(shotN).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path, fullPage });
  console.log("saved", path);
}

await page.goto("http://localhost:4500/preview", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

await shot("dashboard-admin", true);

// try clicking around the sidebar
const sidebarLinks = await page.locator("text=シフトカレンダー").first();
await sidebarLinks.click().catch(() => {});
await page.waitForTimeout(800);
await shot("calendar-admin", true);

await page.locator("text=スタッフ名簿").first().click().catch(() => {});
await page.waitForTimeout(800);
await shot("roster-admin", true);

await page.locator("text=設定").first().click().catch(() => {});
await page.waitForTimeout(800);
await shot("settings-admin", true);

await browser.close();
