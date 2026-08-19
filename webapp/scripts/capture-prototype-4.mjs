import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

let shotN = 30;
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
await page.waitForTimeout(500);
const rosterButtons = await page.locator("button, [role=button], .sc-interp").allTextContents();
console.log("roster clickable texts:", JSON.stringify(rosterButtons.filter((t) => t.trim()).slice(0, 40)));

await browser.close();
