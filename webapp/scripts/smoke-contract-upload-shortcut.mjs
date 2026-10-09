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

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加");
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
  await panel.getByRole("button", { name: "＋契約書を追加" }).click();
  await admin.waitForTimeout(200);

  // 「＋契約書を追加」をタップした直後に、テンプレート選択を経由せず
  // 「契約書を生成」「アップロード」の2択がすぐ出ることを確認する
  // （以前はアップロードが生成フローの3番目のボタンとして埋もれていた）。
  const choiceModal = admin.locator("div.fixed.inset-0.z-30").last();
  log(
    "「＋契約書を追加」をタップすると即座に「契約書を生成」「アップロード」の2択が出る",
    (await choiceModal.getByRole("button", { name: "契約書を生成" }).isVisible()) &&
      (await choiceModal.getByRole("button", { name: /^アップロード/ }).isVisible()),
  );

  await choiceModal.getByRole("button", { name: /^アップロード/ }).click();
  await admin.waitForTimeout(300);

  // アップロードを選ぶと、テンプレート選択を一切経由せず直接アップロード
  // 専用フォーム（必須4項目＋添付）に入る。
  const uploadModal = admin.locator("div.fixed.inset-0.z-30").last();
  log(
    "アップロードを選ぶとテンプレート選択を経由せず直接アップロードフォームに入る",
    await uploadModal.getByText("本人への同意依頼は送られません").isVisible(),
  );
  log("雇用形態の入力欄が直接表示される（テンプレート選択は不要）", await uploadModal.getByText("雇用形態").isVisible());

  console.log(process.exitCode ? "CONTRACT UPLOAD SHORTCUT SMOKE TEST HAD FAILURES" : "CONTRACT UPLOAD SHORTCUT SMOKE TEST PASSED");
} catch (err) {
  console.error("CONTRACT UPLOAD SHORTCUT SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-contract-upload-shortcut-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
