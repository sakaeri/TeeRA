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

const adminEmail = `clientorder-admin-${Date.now()}@example.com`;
const staffEmail = `clientorder-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "検証管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "検証テスト株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  // create a team too — the ＋スタッフを追加 shortcut must skip the team step
  // as well as the workplace step, not just the latter (regression for ③).
  await admin.click("text=設定");
  await admin.waitForURL("http://localhost:3000/company/settings");
  await admin.fill('input[placeholder="新しいチーム名"]', "検証チーム");
  await admin.click("text=＋チームを作成");
  await admin.waitForTimeout(600);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加する");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "テスト");
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
  await staff.fill("#name", "TESUTO");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  // assign TESUTO to client テスト on today's date
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  let modal = admin.locator("div.fixed.inset-0.z-20").last();
  await modal.getByRole("button", { name: "検証チーム" }).click();
  await modal.getByRole("button", { name: "テスト" }).click();
  await modal.getByRole("button", { name: "TESUTO" }).click();
  await modal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await modal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  // month view shows the staff name directly, not just an "オーダーN件" count
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.waitForTimeout(500);
  let bodyText = await admin.textContent("body");
  log("month view shows the assigned staff's name for a client shift", bodyText.includes("TESUTO"));
  log("month view no longer collapses client shifts into オーダーN件", !bodyText.includes("オーダー1件"));

  const now = new Date();
  await admin.locator(`button:has-text("${now.getDate()}")`).first().click();
  await admin.waitForTimeout(300);
  const dayModal = admin.locator("div.fixed.inset-0.z-20").last();
  bodyText = await dayModal.textContent();
  log("day-detail tab is labeled 依頼主 (not the overloaded term オーダー)", bodyText.includes("依頼主"));

  await dayModal.getByRole("button", { name: "依頼主", exact: true }).click();
  await admin.waitForTimeout(300);
  bodyText = await dayModal.textContent();
  log("client list section is labeled 依頼主一覧", bodyText.includes("依頼主一覧"));
  log("old アサイン済みスタッフ label is gone", !bodyText.includes("アサイン済みスタッフ"));

  await dayModal.getByRole("button", { name: /テスト/ }).click();
  await admin.waitForTimeout(300);
  await dayModal.getByRole("button", { name: "＋ スタッフを追加" }).click();
  await admin.waitForTimeout(500);
  bodyText = await admin.textContent("body");
  log(
    "clicking ＋スタッフを追加 does NOT show the FabMenu's シフトを作成/募集を作成 choice",
    !(bodyText.includes("シフトを作成") && bodyText.includes("募集を作成")),
  );
  log("modal title is client-specific (テストにスタッフを追加), not the generic シフトを作成", bodyText.includes("テストにスタッフを追加"));
  log("workplace AND team steps were both skipped straight to staff selection", bodyText.includes("テスト・スタッフを選択"));
  log("team-picker (どのチームのシフトを作成しますか？) is NOT shown for this shortcut", !bodyText.includes("どのチームのシフトを作成しますか"));

  console.log(process.exitCode ? "CLIENT ORDER TAB SMOKE TEST HAD FAILURES" : "CLIENT ORDER TAB SMOKE TEST PASSED");
} catch (err) {
  console.error("CLIENT ORDER TAB SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-client-order-tab-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
