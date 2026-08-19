import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const email = `visual2-${Date.now()}@example.com`;

await page.goto("http://localhost:3000/register");
await page.fill("#name", "ビジュアル確認2");
await page.fill("#email", email);
await page.fill("#password", "password123");
await page.click("button[type=submit]");
await page.waitForURL("http://localhost:3000/register/company");
await page.fill("#name", "ビジュアル確認2株式会社");
await page.click("button[type=submit]");
await page.waitForURL("http://localhost:3000/company");

await page.goto("http://localhost:3000/company/calendar");
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/visual2-calendar.png", fullPage: true });

// open FAB menu
await page.locator("text=＋").last().click();
await page.waitForTimeout(300);
await page.screenshot({ path: "/tmp/visual2-fab-menu.png" });

await browser.close();
