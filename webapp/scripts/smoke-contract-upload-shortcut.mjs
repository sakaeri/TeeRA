import { chromium } from "playwright-core";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();
const adminEmail = `upload-shortcut-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "ショートカット太郎");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "ショートカット株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("検証業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("HOURLY");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1000");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "ショートカット花子");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(1000);

  await admin.reload();
  await admin.waitForTimeout(500);
  await admin.click("text=ショートカット花子");
  await admin.waitForTimeout(300);
  const panel = admin.locator("div.fixed.inset-0.z-30, div.fixed.inset-0.z-20").last();
  await panel.getByRole("button", { name: "契約書管理" }).click();
  await panel.getByRole("button", { name: "＋契約書を生成" }).click();
  await admin.waitForTimeout(200);
  const chooseModal = admin.locator("div.fixed.inset-0.z-30").last();
  await chooseModal.locator("select").selectOption({ label: "アルバイト・検証業務" });
  await chooseModal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);

  const assignModal = admin.locator("div.fixed.inset-0.z-30").last();
  log(
    "テンプレート選択後の分岐に「アップロードのみ」ボタンが出る",
    await assignModal.getByRole("button", { name: "アップロードのみ（書面で契約済み）" }).isVisible(),
  );
  await assignModal.getByRole("button", { name: "アップロードのみ（書面で契約済み）" }).click();
  await admin.waitForTimeout(300);

  const genModal = admin.locator("div.fixed.inset-0.z-30").last();
  const uploadModeBtn = genModal.getByRole("button", { name: "アップロードのみ（既に書面で契約済み）" });
  const className = await uploadModeBtn.getAttribute("class");
  log("ショートカットから入るとアップロードのみが最初から選択されている", className.includes("bg-primary"));
  log(
    "アップロード必須の案内も最初から表示される",
    await genModal.getByText("本人への同意依頼は送られません").isVisible(),
  );

  console.log(process.exitCode ? "CONTRACT UPLOAD SHORTCUT SMOKE TEST HAD FAILURES" : "CONTRACT UPLOAD SHORTCUT SMOKE TEST PASSED");
} catch (err) {
  console.error("CONTRACT UPLOAD SHORTCUT SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-contract-upload-shortcut-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
