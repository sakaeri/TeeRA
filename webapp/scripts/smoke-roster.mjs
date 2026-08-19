import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const page = await browser.newPage();
const email = `roster-smoke-${Date.now()}@example.com`;

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

try {
  // register + create company
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "ロスター太郎");
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", "ロスターテスト株式会社");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");

  // go to roster
  await page.click("text=スタッフ名簿");
  await page.waitForURL("http://localhost:3000/company/roster");

  // invite real staff
  await page.click("text=＋スタッフを招待する");
  await page.click("text=本アカウントを招待");
  await page.waitForSelector("text=招待URL:");
  let bodyText = await page.textContent("body");
  log("staff invite URL shown", bodyText.includes("招待URL:") && bodyText.includes("/invite/"));

  // create proxy staff
  await page.click("text=＋スタッフを招待する");
  await page.click("text=仮アカウントを作成");
  await page.fill('input[placeholder="名称を入力"]', "仮スタッフ花子");
  await page.click("text=作成");
  await page.waitForTimeout(800);
  bodyText = await page.textContent("body");
  log("proxy staff appears in list with 仮 badge", bodyText.includes("仮スタッフ花子") && bodyText.includes("仮"));
  log("proxy staff has upgrade link", bodyText.includes("本アカウントと連携する"));

  // activate agency module via + 取引先名簿を追加 -> 依頼主名簿
  await page.click("text=＋ 取引先名簿を追加");
  await page.click("text=依頼主名簿");
  await page.fill('input[placeholder="名称を入力"]', "仮依頼主サンプル");
  await page.click("text=作成");
  await page.waitForTimeout(800);
  bodyText = await page.textContent("body");
  log("agency module activated -> 依頼主一覧 tab visible", bodyText.includes("依頼主一覧"));
  log("proxy client relationship listed", bodyText.includes("仮依頼主サンプル"));

  // settings: rename company, create team, assign role
  await page.click("text=設定");
  await page.waitForURL("http://localhost:3000/company/settings");
  await page.fill('input[placeholder="新しいチーム名"]', "工場チーム");
  await page.click("text=＋チームを作成");
  await page.waitForTimeout(800);
  bodyText = await page.textContent("body");
  log("team created", bodyText.includes("工場チーム"));

  console.log(process.exitCode ? "ROSTER SMOKE TEST HAD FAILURES" : "ROSTER SMOKE TEST PASSED");
} catch (err) {
  console.error("ROSTER SMOKE TEST FAILED", err);
  await page.screenshot({ path: "/tmp/smoke-roster-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
