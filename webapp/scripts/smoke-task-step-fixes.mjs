import { chromium } from "playwright-core";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminEmail = `taskstep-admin-${Date.now()}@example.com`;
const staffEmail = `taskstep-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "戻る検証管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "戻る検証株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加する");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "戻る先");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "戻るスタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  const modal = admin.locator("div.fixed.inset-0.z-20").last();
  await modal.getByRole("button", { name: "戻る先" }).click();
  await admin.waitForTimeout(200);

  // no more 選ばずに進む escape hatch on the task step
  let bodyText = await modal.textContent();
  log("選ばずに進む skip link is gone from the task step", !bodyText.includes("選ばずに進む"));

  // add a new task, advance to staff step, then go back to task step —
  // reproduces the user's report: duplicate options after add + back navigation
  await modal.getByRole("button", { name: /新しい業務内容を追加する/ }).click();
  await modal.locator('input[placeholder*="業務内容"]').fill("キャディ業務");
  await modal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await admin.waitForTimeout(600); // let the revalidate-triggered prop refresh land

  bodyText = await modal.textContent();
  log("advanced to staff step, header shows the selected 業務内容", bodyText.includes("戻る先・キャディ業務・スタッフを選択"));

  await modal.getByRole("button", { name: "＜ 戻る" }).click();
  await admin.waitForTimeout(300);
  const taskButtons = modal.getByRole("button", { name: "キャディ業務" });
  log("going back to the task step shows キャディ業務 exactly once (no duplicate)", (await taskButtons.count()) === 1);

  // proceed again and check the datetime step header too
  await taskButtons.click();
  await admin.waitForTimeout(300);
  await modal.getByRole("button", { name: "戻るスタッフ" }).click();
  await admin.waitForTimeout(300);
  bodyText = await modal.textContent();
  log("datetime step header also shows the selected 業務内容", bodyText.includes("戻る先・キャディ業務・戻るスタッフ"));

  console.log(process.exitCode ? "TASK STEP FIXES SMOKE TEST HAD FAILURES" : "TASK STEP FIXES SMOKE TEST PASSED");
} catch (err) {
  console.error("TASK STEP FIXES SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-task-step-fixes-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
