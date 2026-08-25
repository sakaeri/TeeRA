import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const email = `visual-${Date.now()}@example.com`;

await page.goto("http://localhost:3000/register");
await page.fill("#name", "ビジュアル確認");
await page.fill("#email", email);
await page.fill("#password", "password123");
await page.click("button[type=submit]");
await page.waitForURL("http://localhost:3000/register/company");
await page.fill("#name", "ビジュアル確認株式会社");
await page.click("button[type=submit]");
await page.waitForURL("http://localhost:3000/company");
await page.screenshot({ path: "/tmp/visual-dashboard.png", fullPage: true });

await page.goto("http://localhost:3000/company/calendar");
await page.locator("button", { hasText: "＋" }).last().click();
await page.getByText("シフトを作成").click();
await page.waitForSelector("text=勤務先を選択");
await page.screenshot({ path: "/tmp/visual-assign-modal.png" });
await page.keyboard.press("Escape").catch(() => {});

await browser.close();
