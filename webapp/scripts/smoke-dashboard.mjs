import { chromium } from "playwright-core";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const email = `dash-admin-${Date.now()}@example.com`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "ダッシュボード管理者");
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", "ダッシュボードテスト株式会社");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");

  let body = await page.textContent("body");
  log("KPI cards render with 0 counts initially", body.includes("欠員件数") && body.includes("未確定シフト"));

  // create a regular staff member — they must NOT be an assignable recipient
  // (only company admins/editors can see this dashboard and resolve todos)
  await page.click("text=スタッフ名簿");
  await page.click("text=＋スタッフを追加する");
  await page.click("text=仮アカウントを作成");
  await page.fill('input[placeholder="名称を入力"]', "一般スタッフ");
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.waitForTimeout(600);

  await page.getByRole("link", { name: "ダッシュボード", exact: true }).click();
  await page.waitForURL("http://localhost:3000/company");

  await page.click("text=＋やることリスト作成");
  const createdByValue = await page.locator('input[disabled]').inputValue();
  log("誰が出したか shows the current admin's real name", createdByValue === "ダッシュボード管理者（自動入力）");
  // scoped to the 誰宛か <select> specifically — 一般スタッフ legitimately
  // appears elsewhere on the page now (e.g. an auto 契約書 to-do, since they
  // have no contract), so a whole-body text check would be a false positive
  const recipientOptionLabels = await page.locator("select").first().locator("option").allTextContents();
  log("regular staff is not offered as a recipient", !recipientOptionLabels.includes("一般スタッフ"));

  await page.fill('input[placeholder="やることを入力"]', "契約書を確認してください");
  await page.fill('input[type=date]', "2026-09-01");
  await page.selectOption("select", { label: "ダッシュボード管理者" });
  await page.getByRole("button", { name: "作成する" }).click();
  await page.waitForTimeout(600);

  body = await page.textContent("body");
  log("manual todo appears in 未対応 tab", body.includes("契約書を確認してください") && body.includes("ダッシュボード管理者宛"));

  // add a comment
  await page.click("text=コメント（0）");
  await page.fill('input[placeholder="コメントを追加"]', "確認お願いします");
  await page.getByRole("button", { name: "送信" }).click();
  await page.waitForTimeout(600);
  body = await page.textContent("body");
  log("comment thread shows the added comment", body.includes("確認お願いします"));

  // resolve it
  await page.getByRole("button", { name: "解決済みにする" }).click();
  await page.waitForTimeout(600);
  // 一般スタッフ has no contract, so an unrelated auto 契約書 to-do now
  // legitimately stays in 未対応 — check the manual todo specifically left,
  // not that the tab is fully empty
  log(
    "todo removed from 未対応 after resolving",
    !(await page.getByText("契約書を確認してください").isVisible().catch(() => false)),
  );

  await page.click("text=解決済みリスト");
  body = await page.textContent("body");
  log("todo appears in 解決済み tab", body.includes("契約書を確認してください"));
  log(
    "解決済み tab shows small 誰から→誰宛（解決日）subtext",
    body.includes("ダッシュボード管理者 → ダッシュボード管理者宛（解決日"),
  );
  log("no 再オープン button in 解決済み tab", !body.includes("再オープン"));
  log("コメント link shown in 解決済み tab", body.includes("コメント（1）"));

  // the comment thread stayed expanded from the 未対応 tab interaction above
  // (expandedId state carries across tabs), so collapse then re-expand it here
  await page.click("text=コメント（1）");
  await page.waitForTimeout(300);
  await page.click("text=コメント（1）");
  await page.waitForTimeout(300);
  body = await page.textContent("body");
  log("resolved todo comment thread is viewable", body.includes("確認お願いします"));

  console.log(process.exitCode ? "DASHBOARD SMOKE TEST HAD FAILURES" : "DASHBOARD SMOKE TEST PASSED");
} catch (err) {
  console.error("DASHBOARD SMOKE TEST FAILED", err);
  await page.screenshot({ path: "/tmp/smoke-dashboard-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
