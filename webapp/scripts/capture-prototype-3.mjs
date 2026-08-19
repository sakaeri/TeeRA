import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

let shotN = 20;
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

// Tee balance -> wallet modal
await fresh();
await page.locator("text=45 Tee").click();
await page.waitForTimeout(500);
await shot("wallet-modal", true);

// avatar -> profile
await fresh();
await page.locator("text=斎").click();
await page.waitForTimeout(500);
await shot("profile-modal", true);

// roster invite modal
await fresh();
await page.locator("text=スタッフ名簿").first().click();
await page.waitForTimeout(500);
await page.locator("text=+ スタッフを招待する").click();
await page.waitForTimeout(500);
await shot("roster-invite-modal", true);

// roster add client tab
await fresh();
await page.locator("text=スタッフ名簿").first().click();
await page.waitForTimeout(500);
await page.locator("text=+ 取引先名簿を追加").click();
await page.waitForTimeout(500);
await shot("roster-add-client-menu", true);

// roster staff row click (may open detail)
await fresh();
await page.locator("text=スタッフ名簿").first().click();
await page.waitForTimeout(500);
await page.locator("text=田中 陽菜").click();
await page.waitForTimeout(500);
await shot("roster-staff-detail", true);

// settings scrolled
await fresh();
await page.locator("text=設定").first().click();
await page.waitForTimeout(500);
await page.mouse.wheel(0, 900);
await page.waitForTimeout(400);
await shot("settings-scrolled", true);

// settings: team detail
await fresh();
await page.locator("text=設定").first().click();
await page.waitForTimeout(500);
await page.locator("text=工場チーム").click();
await page.waitForTimeout(500);
await shot("settings-team-detail", true);

// settings: contract template detail
await fresh();
await page.locator("text=設定").first().click();
await page.waitForTimeout(500);
await page.locator("text=アルバイト（ホール）").click();
await page.waitForTimeout(500);
await shot("settings-contract-detail", true);

console.log("batch 3 done");
await browser.close();
