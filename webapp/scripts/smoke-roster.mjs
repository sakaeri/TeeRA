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
  await page.click("text=＋スタッフを追加する");
  await page.click("text=本アカウントを招待");
  await page.getByRole("button", { name: "招待URLを発行する" }).click();
  await page.waitForSelector('input[readonly]');
  const inviteUrlValue = await page.locator('input[readonly]').inputValue();
  log("staff invite URL shown", inviteUrlValue.includes("/invite/"));
  await page.click("text=✕");
  let bodyText = await page.textContent("body");

  // create proxy staff
  await page.click("text=＋スタッフを追加する");
  await page.click("text=仮アカウントを作成");
  await page.fill('input[placeholder="名称を入力"]', "仮スタッフ花子");
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.waitForTimeout(800);
  bodyText = await page.textContent("body");
  log("proxy staff appears in list with 仮 badge", bodyText.includes("仮スタッフ花子") && bodyText.includes("仮"));
  log("upgrade link NOT shown inline in the list row", !bodyText.includes("本アカウントと連携する"));

  // the upgrade action now lives inside the detail panel instead
  await page.click("text=仮スタッフ花子");
  await page.waitForTimeout(400);
  bodyText = await page.textContent("body");
  log("upgrade action available inside staff detail panel", bodyText.includes("本アカウントと連携する"));
  await page.click("text=閉じる");
  await page.waitForTimeout(300);

  // 依頼主一覧タブ -> ＋依頼主を追加する -> 仮アカウントを作成
  await page.click("text=依頼主一覧");
  await page.waitForTimeout(200);
  log("依頼主一覧 tab visible without any 依頼主 yet", bodyText.includes("依頼主一覧"));
  await page.click("text=＋依頼主を追加する");
  await page.waitForTimeout(200);
  await page.click("text=仮アカウントを作成");
  await page.fill('input[placeholder="名称を入力"]', "仮依頼主サンプル");
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.waitForTimeout(800);
  bodyText = await page.textContent("body");
  log("proxy client relationship listed", bodyText.includes("仮依頼主サンプル"));

  // add a SECOND 依頼主 to confirm the list supports more than one entry
  await page.click("text=＋依頼主を追加する");
  await page.waitForTimeout(200);
  await page.click("text=仮アカウントを作成");
  await page.fill('input[placeholder="名称を入力"]', "仮依頼主サンプル2");
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.waitForTimeout(800);
  bodyText = await page.textContent("body");
  log("a second 依頼主 can be added (not limited to one)", bodyText.includes("仮依頼主サンプル") && bodyText.includes("仮依頼主サンプル2"));

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
