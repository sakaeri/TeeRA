import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on("pageerror", (err) => console.log("[pageerror]", err.message.slice(0, 300)));

let shotN = 60;
async function shot(name, fullPage = false) {
  shotN += 1;
  const path = `/tmp/proto/${String(shotN).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path, fullPage });
  console.log("saved", path);
}

await page.goto("http://localhost:4500/preview", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1000);
await page.locator("text=スタッフ名簿").first().click();
await page.waitForTimeout(600);
await page.locator("text=＋ 取引先名簿を追加").click();
await page.waitForTimeout(500);
await page.locator("text=仮アカウントを作成").first().click();
await page.waitForTimeout(800);
await shot("after-add-proxy-client", true);

const texts = await page.locator("button, [role=button], a, td, th").allTextContents();
console.log("after add:", JSON.stringify(texts.filter((t) => t.trim()).slice(0, 60)));

console.log("done batch 8");
await browser.close();
