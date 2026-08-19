import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on("pageerror", (err) => console.log("[pageerror]", err.message.slice(0, 300)));

let shotN = 50;
async function shot(name, fullPage = false) {
  shotN += 1;
  const path = `/tmp/proto/${String(shotN).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path, fullPage });
  console.log("saved", path);
}
async function fresh() {
  await page.goto("http://localhost:4500/preview", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
}

await fresh();
await page.locator("text=スタッフ名簿").first().click();
await page.waitForTimeout(600);
const allTexts = await page.locator("button, [role=button], a, .sc-interp, td, th").allTextContents();
console.log("roster page texts:", JSON.stringify(allTexts.filter((t) => t.trim()).slice(0, 60)));
await shot("roster-full-page", true);

console.log("batch 7 done");
await browser.close();
