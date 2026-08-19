import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("/tmp/proto", { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

let shotN = 10;
async function shot(name, fullPage = false) {
  shotN += 1;
  const path = `/tmp/proto/${String(shotN).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path, fullPage });
  console.log("saved", path);
}

await page.goto("http://localhost:4500/preview", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

// Calendar: FAB menu
await page.locator("text=シフトカレンダー").first().click();
await page.waitForTimeout(600);
await page.locator("button.MuiFab-root, [class*='fixed']").last().click({ force: true }).catch(async () => {
  // fallback: click bottom-right floating button by position
  await page.mouse.click(1336, 936);
});
await page.waitForTimeout(500);
await shot("calendar-fab-menu");

await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(300);

// Calendar: click a day with shifts (22nd, has multiple pills)
await page.locator("text=22").first().click({ force: true }).catch(() => {});
await page.waitForTimeout(600);
await shot("calendar-day-detail", true);

await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(300);

// Roster: invite button + client tab
await page.locator("text=スタッフ名簿").first().click();
await page.waitForTimeout(600);
await page.locator("text=+ スタッフを招待する").click().catch(() => {});
await page.waitForTimeout(500);
await shot("roster-invite-modal");
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(300);

await page.locator("text=+ 取引先名簿を追加").click().catch(() => {});
await page.waitForTimeout(500);
await shot("roster-add-client-menu");
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(300);

// Settings: full page + team detail + contract detail
await page.locator("text=設定").first().click();
await page.waitForTimeout(600);
await page.mouse.wheel(0, 800);
await page.waitForTimeout(400);
await shot("settings-scrolled", true);

console.log("done batch 2");
await browser.close();
