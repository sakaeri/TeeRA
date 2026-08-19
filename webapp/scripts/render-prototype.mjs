import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("console", (msg) => console.log("[console]", msg.type(), msg.text().slice(0, 300)));
page.on("pageerror", (err) => console.log("[pageerror]", err.message.slice(0, 500)));

await page.goto("http://localhost:4500/preview", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

const bodyHTML = await page.evaluate(() => document.body.innerHTML.length);
console.log("body innerHTML length:", bodyHTML);

await page.screenshot({ path: "/tmp/prototype-initial.png", fullPage: false });

await browser.close();
