import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 500, height: 900 } });

let shotN = 40;
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
await page.locator("text=スタッフとして表示").click();
await page.waitForTimeout(800);
await shot("staff-calendar", true);

console.log("batch 6 done");
await browser.close();
