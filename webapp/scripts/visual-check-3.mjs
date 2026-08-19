import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const email = `visual3-${Date.now()}@example.com`;

await page.goto("http://localhost:3000/register");
await page.fill("#name", "ビジュアル確認3");
await page.fill("#email", email);
await page.fill("#password", "password123");
await page.click("button[type=submit]");
await page.waitForURL("http://localhost:3000/register/company");
await page.fill("#name", "ビジュアル確認3株式会社");
await page.click("button[type=submit]");
await page.waitForURL("http://localhost:3000/company");

await page.goto("http://localhost:3000/company/roster");
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/visual3-roster.png", fullPage: true });

await browser.close();
