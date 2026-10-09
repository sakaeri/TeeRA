import { chromium } from "playwright-core";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();
const staff = await (await browser.newContext()).newPage();

const adminEmail = `navlock-admin-${Date.now()}@example.com`;
const staffEmail = `navlock-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "離脱防止管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "離脱防止株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("検証業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("HOURLY");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1200");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "離脱防止花子");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  // 同意前: ホームにいる状態で確認する
  log("契約書が無い間は通常通りホームにいられる", staff.url().includes("/staff"));

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=離脱防止花子");
  await admin.waitForTimeout(300);
  const panel = admin.locator("div.fixed.inset-0.z-30").first();
  await panel.getByRole("button", { name: "契約書管理" }).click();
  await panel.getByRole("button", { name: "＋契約書を追加" }).click();
  await panel.getByRole("button", { name: "契約書を生成" }).click();
  await admin.waitForTimeout(200);
  const chooseModal = admin.locator("div.fixed.inset-0.z-30").last();
  await chooseModal.locator("select").selectOption({ label: "アルバイト・検証業務" });
  await chooseModal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  const assignModal = admin.locator("div.fixed.inset-0.z-30").last();
  await assignModal.getByRole("button", { name: "このテンプレートのまま契約する" }).click();
  await admin.waitForTimeout(700);

  // 確認待ちの契約書がある状態で、別ページへ直接遷移を試みる
  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.waitForTimeout(800);
  log(
    "確認待ちの契約書がある間は他ページへ直接遷移しても契約書ページへ戻される",
    staff.url().includes("/staff/contracts"),
  );

  await staff.goto("http://localhost:3000/staff/recruitments");
  await staff.waitForTimeout(800);
  log("募集一覧への直接遷移も戻される", staff.url().includes("/staff/contracts"));

  // ナビのリンクをクリックしても遷移しない
  await staff.goto("http://localhost:3000/staff/contracts");
  await staff.waitForTimeout(500);
  await staff.getByRole("link", { name: "タイムカード" }).click({ force: true }).catch(() => {});
  await staff.waitForTimeout(500);
  log("ナビの他リンクをクリックしても遷移しない", staff.url().includes("/staff/contracts"));

  // 同意すると通常のナビゲーションに戻る
  await staff.goto(`http://localhost:3000/staff/contracts`);
  await staff.waitForTimeout(500);
  await staff.getByRole("link", { name: /離脱防止株式会社/ }).click();
  await staff.waitForTimeout(500);
  await staff.getByRole("button", { name: "契約書の全文を確認する" }).click();
  await staff.waitForTimeout(300);
  const consentModal = staff.locator("div.fixed.inset-0.z-30").last();
  await consentModal.locator('label:has-text("氏名") input').fill("離脱防止花子");
  await consentModal.locator('label:has-text("住所") input').fill("東京都品川区6-6-6");
  await consentModal.locator('label:has-text("電話番号") input').fill("090-1212-3434");
  await consentModal.getByRole("button", { name: "内容を確認しました（同意する）" }).click();
  await staff.waitForTimeout(600);

  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.waitForTimeout(800);
  log("同意後は他ページへ普通に遷移できる", staff.url().includes("/staff/timecard"));

  console.log(process.exitCode ? "CONTRACT WIZARD NAVIGATION LOCK SMOKE TEST HAD FAILURES" : "CONTRACT WIZARD NAVIGATION LOCK SMOKE TEST PASSED");
} catch (err) {
  console.error("CONTRACT WIZARD NAVIGATION LOCK SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-navlock-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-navlock-staff-failure.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
