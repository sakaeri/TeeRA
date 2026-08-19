import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("console", (msg) => console.log("[console]", msg.type(), msg.text()));
page.on("pageerror", (err) => console.log("[pageerror]", err.message));
page.on("requestfailed", (req) => console.log("[requestfailed]", req.url(), req.failure()?.errorText));

const email = `debug-${Date.now()}@example.com`;

await page.goto("http://localhost:3000/register");
await page.fill("#name", "デバッグ管理者");
await page.fill("#email", email);
await page.fill("#password", "password123");
await page.click("button[type=submit]");
await page.waitForURL("http://localhost:3000/register/company");
await page.fill("#name", "デバッグ株式会社");
await page.click("button[type=submit]");
await page.waitForURL("http://localhost:3000/company");

await page.click("text=スタッフ名簿");
await page.click("text=+ 仮アカウントを作成");
await page.fill('input[placeholder="名称を入力"]', "デバッグスタッフ");
await page.click("text=作成");
await page.waitForTimeout(800);

// seed a shift request directly for this proxy staff via psql from shell after this script prints ids
const bodyText = await page.textContent("body");
console.log("roster body snippet:", bodyText.includes("デバッグスタッフ"));

await browser.close();
