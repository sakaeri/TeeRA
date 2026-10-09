import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(
    `PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`,
  )
    .toString()
    .trim();
}

const fakePdfPath = "/tmp/claude-contract-upload-smoke.pdf";
writeFileSync(fakePdfPath, "%PDF-1.4 fake contract scan for smoke test");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();

const adminEmail = `contract-upload-admin-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "アップロード管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "アップロード契約株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  // このサンドボックスにはVercel Blobの認証情報が無いため、実際のアップ
  // ロードAPIは失敗する（smoke-profile-team-proxy-iddoc-edits.mjsと同じ
  // 回避策）。アップロードモーダルの動作自体の確認が目的なので、/api/upload
  // をモックして固定URLを返す。
  await admin.route("**/api/upload", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: "https://example.com/signed-contract.pdf" }),
    }),
  );

  // base ACTIVE template to generate from (used by the normal-mode sanity check)
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("フロント業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("HOURLY");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1200");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);

  // proxy staff who already signed a paper contract before TeeRA existed
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=仮アカウントを作成");
  await admin.locator("input[type=text]").last().fill("アップロード太郎");
  await admin.getByRole("button", { name: "作成" }).click();
  await admin.waitForTimeout(1200);

  await admin.reload();
  await admin.waitForTimeout(500);
  await admin.locator("tbody tr", { hasText: "アップロード太郎" }).click();
  await admin.waitForTimeout(300);
  const panel = admin.locator("div.fixed.inset-0.z-30").first();
  await panel.getByRole("button", { name: "契約書管理" }).click();
  await panel.getByRole("button", { name: "＋契約書を追加" }).click();
  await admin.waitForTimeout(200);

  const choiceModal = admin.locator("div.fixed.inset-0.z-30").last();
  log("「契約書を生成」「アップロード」の2択が最初に出る", await choiceModal.getByRole("button", { name: /^アップロード/ }).isVisible());
  await choiceModal.getByRole("button", { name: /^アップロード/ }).click();
  await admin.waitForTimeout(200);

  const uploadModal = admin.locator("div.fixed.inset-0.z-30").last();
  log(
    "アップロード必須の案内文が表示される",
    await uploadModal.getByText("本人への同意依頼は送られません").isVisible(),
  );

  const submitButton = uploadModal.getByRole("button", { name: "保存する" });
  log("雇用条件未入力・ファイル添付前は保存ボタンが無効", await submitButton.isDisabled());

  await uploadModal.locator('label:has-text("業務内容") input').fill("フロント業務");
  await uploadModal.locator('label:has-text("基本給") input[type=number]').fill("1200");
  await admin.waitForTimeout(100);
  log("業務内容・基本給を入れてもファイル未添付なら保存ボタンは無効のまま", await submitButton.isDisabled());

  await uploadModal.locator('input[type="file"]').setInputFiles(fakePdfPath);
  await admin.waitForTimeout(1000);

  log("業務内容・基本給・ファイルが揃うと保存ボタンが有効になる", !(await submitButton.isDisabled()));

  // address/phone are optional, filled here via the collapsed <details> section
  await uploadModal.getByText("住所・電話番号を入力する（任意）").click();
  await uploadModal.locator('label:has-text("住所") input').fill("東京都港区3-3-3");
  await uploadModal.locator('label:has-text("電話番号") input').fill("090-5555-6666");
  await admin.waitForTimeout(200);

  await submitButton.click();
  await admin.waitForTimeout(1000);

  const proxyUserId = psql(`select id from "User" where name='アップロード太郎' order by "createdAt" desc limit 1;`);
  const contractRow = psql(
    `select status || '|' || coalesce("uploadedDocumentUrl",'') || '|' || (("consentedAt" is not null)::text) from "StaffContract" where "staffUserId"='${proxyUserId}' order by "createdAt" desc limit 1;`,
  );
  const [status, uploadedUrl, hasConsentedAt] = contractRow.split("|");
  log("アップロードで作成した契約は即座にACTIVEになる（同意待ちを経由しない）", status === "ACTIVE");
  log("アップロードした署名済み書面のURLが記録される", uploadedUrl === "https://example.com/signed-contract.pdf");
  log("consentedAtも同時に記録される", hasConsentedAt === "true");

  const templateRow = psql(
    `select t."workplaceType" is null and t."scheduleType" is null and t."contractPeriodType" is null and t."isUploadOnly" from "StaffContract" sc join "ContractTemplate" t on t.id=sc."templateId" where sc."staffUserId"='${proxyUserId}' order by sc."createdAt" desc limit 1;`,
  );
  log("アップロード用テンプレは勤務形態・スケジュール区分・契約期間区分を持たずisUploadOnly=trueで作られる", templateRow === "t");

  const partyRow = psql(
    `select coalesce("partyName",'') || '|' || "partyAddress" || '|' || "partyPhoneNumber" from "StaffContract" where "staffUserId"='${proxyUserId}' order by "createdAt" desc limit 1;`,
  );
  log(
    "氏名は記録されず、入力した住所・電話番号だけがアップロード契約に記録される",
    partyRow === "|東京都港区3-3-3|090-5555-6666",
  );

  await admin.waitForTimeout(500);

  // uploading successfully also opens a follow-up guidance popup (有給/本人
  // 確認書類/振込先情報); dismiss it before continuing.
  const guidanceModal = admin.locator("div.fixed.inset-0.z-30").last();
  log("アップロード後に有給・本人確認書類・振込先情報の案内ポップアップが出る", await guidanceModal.getByText("続けて、以下の項目を今すぐ入力しますか？").isVisible());
  await guidanceModal.locator("text=✕").click();
  await admin.waitForTimeout(300);

  const panelText = await panel.textContent();
  log("スタッフ詳細の現在の契約に「書面アップロード」の注記が出る", panelText.includes("書面アップロード"));

  // open the simplified read-only detail view (not the full template-body view)
  await panel.getByRole("button", { name: "詳細確認" }).first().click();
  await admin.waitForTimeout(300);
  const detailModal = admin.locator("div.fixed.inset-0.z-30").last();
  log("詳細確認モーダルにアップロードされた書面へのリンクが表示される", await detailModal.getByText("アップロードされた署名済み書面を見る").isVisible());
  log("詳細確認モーダルは必須4項目のみのシンプルな表示になる（本文風の表示はしない）", await detailModal.getByText("業務内容").isVisible());
  await detailModal.locator("text=✕").click();
  await admin.waitForTimeout(300);

  // --- sanity check: normal mode (no upload) still behaves as before ---
  await panel.getByRole("button", { name: "＋契約書を追加" }).click();
  await panel.getByRole("button", { name: "契約書を生成" }).click();
  await admin.waitForTimeout(200);
  const chooseModal2 = admin.locator("div.fixed.inset-0.z-30").last();
  const templatePickerOptionCount = await chooseModal2.locator("select option").count();
  log(
    "アップロード用の軽量テンプレは通常の生成テンプレ一覧には出ない（選択肢は基本テンプレ1件＋未選択のみ）",
    templatePickerOptionCount === 2,
  );
  const ackCheckbox = chooseModal2.locator('input[type="checkbox"]');
  if ((await ackCheckbox.count()) > 0) await ackCheckbox.check();
  await chooseModal2.locator("select").selectOption({ label: "アルバイト・フロント業務" });
  await chooseModal2.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  const assignModal2 = admin.locator("div.fixed.inset-0.z-30").last();
  await assignModal2.getByRole("button", { name: "内容を編集して専用の契約書を作る" }).click();
  await admin.waitForTimeout(300);
  const genModal2 = admin.locator("div.fixed.inset-0.z-30").last();
  await genModal2.getByRole("button", { name: "生成する" }).click();
  await admin.waitForTimeout(1000);

  const newestStatus = psql(
    `select status from "StaffContract" where "staffUserId"='${proxyUserId}' order by "createdAt" desc limit 1;`,
  );
  log("通常モードでは引き続きPENDING_CONSENTで作成される（アップロードの追加で既存動作が壊れていない）", newestStatus === "PENDING_CONSENT");

  console.log(process.exitCode ? "CONTRACT UPLOAD-ONLY SMOKE TEST HAD FAILURES" : "CONTRACT UPLOAD-ONLY SMOKE TEST PASSED");
} catch (err) {
  console.error("CONTRACT UPLOAD-ONLY SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-contract-upload-only-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
