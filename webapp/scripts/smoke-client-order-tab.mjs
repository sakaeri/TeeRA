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

  // create a team too — this used to make the (now-removed) ＋スタッフを追加
  // shortcut show a redundant team-picker step; confirm no such shortcut
  // remains reachable at all now.
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

  // assign TESUTO to client テスト (via the normal ＋ button flow, incl. team)
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

  // month view: staff name shown, always green (no sky-blue distinction)
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.waitForTimeout(500);
  let bodyText = await admin.textContent("body");
  log("month view shows the assigned staff's name for a client shift", bodyText.includes("TESUTO"));
  const staffTagEl = await admin.locator("span:has-text('TESUTO')").first();
  const staffTagClass = (await staffTagEl.getAttribute("class")) ?? "";
  log("client-workplace shift's name tag is green like any other confirmed shift", staffTagClass.includes("emerald"));
  log("client-workplace shift's name tag is NOT sky-blue", !staffTagClass.includes("sky"));
  log("month view does not show an オーダーN件 badge for a shift WE created", !bodyText.includes("オーダー1件"));

  const now = new Date();
  await admin.locator(`button:has-text("${now.getDate()}")`).first().click();
  await admin.waitForTimeout(300);
  const dayModal = admin.locator("div.fixed.inset-0.z-20").last();
  bodyText = await dayModal.textContent();
  log(
    "day-detail has no オーダー tab (only a shift WE assigned, no client-posted recruitment exists)",
    !bodyText.includes("オーダー"),
  );
  log("the assigned shift shows up in スタッフシフト with its 依頼主 badge inline", bodyText.includes("TESUTO") && bodyText.includes("テスト"));

  console.log(process.exitCode ? "CLIENT ORDER TAB SMOKE TEST HAD FAILURES" : "CLIENT ORDER TAB SMOKE TEST PASSED");
} catch (err) {
  console.error("CLIENT ORDER TAB SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-client-order-tab-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
