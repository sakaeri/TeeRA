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

  // base ACTIVE template to generate from
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("フロント業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("HOURLY");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1200");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);

  // proxy staff who already signed a paper contract before TeeRA existed
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
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
  await panel.getByRole("button", { name: "＋契約書を生成" }).click();
  await admin.waitForTimeout(200);

  const chooseModal = admin.locator("div.fixed.inset-0.z-30").last();
  await chooseModal.locator("select").selectOption({ label: "アルバイト・フロント業務" });
  await chooseModal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);

  const assignModal = admin.locator("div.fixed.inset-0.z-30").last();
  await assignModal.getByRole("button", { name: "内容を編集して専用の契約書を作る" }).click();
  await admin.waitForTimeout(300);

  const genModal = admin.locator("div.fixed.inset-0.z-30").last();
  log("アップロードのみモードの切り替えボタンが表示される", await genModal.getByText("アップロードのみ（既に書面で契約済み）").isVisible());

  // switch to upload-only mode and attach the signed paper contract scan
  await genModal.getByText("アップロードのみ（既に書面で契約済み）").click();
  await admin.waitForTimeout(200);
  log(
    "アップロード必須の案内文が表示される",
    await genModal.getByText("本人への同意依頼は送られません").isVisible(),
  );

  const submitButton = genModal.getByRole("button", { name: "生成する" });
  log("ファイル添付前は生成ボタンが無効", await submitButton.isDisabled());

  await genModal.locator('input[type="file"]').setInputFiles(fakePdfPath);
  await admin.waitForTimeout(1000);

  log("ファイル添付のみでは住所・電話番号未入力のため生成ボタンは無効のまま", await submitButton.isDisabled());

  await genModal.locator('label:has-text("住所") input').fill("東京都港区3-3-3");
  await genModal.locator('label:has-text("電話番号") input').fill("090-5555-6666");
  await admin.waitForTimeout(200);

  log("住所・電話番号も入力すると生成ボタンが有効になる", !(await submitButton.isDisabled()));
  await submitButton.click();
  await admin.waitForTimeout(1000);

  const proxyUserId = psql(`select id from "User" where name='アップロード太郎' order by "createdAt" desc limit 1;`);
  const contractRow = psql(
    `select status || '|' || coalesce("uploadedDocumentUrl",'') || '|' || (("consentedAt" is not null)::text) from "StaffContract" where "staffUserId"='${proxyUserId}' order by "createdAt" desc limit 1;`,
  );
  const [status, uploadedUrl, hasConsentedAt] = contractRow.split("|");
  log("アップロードのみモードで作成した契約は即座にACTIVEになる（同意待ちを経由しない）", status === "ACTIVE");
  log("アップロードした署名済み書面のURLが記録される", uploadedUrl === "https://example.com/signed-contract.pdf");
  log("consentedAtも同時に記録される", hasConsentedAt === "true");

  const partyRow = psql(
    `select "partyName" || '|' || "partyAddress" || '|' || "partyPhoneNumber" from "StaffContract" where "staffUserId"='${proxyUserId}' order by "createdAt" desc limit 1;`,
  );
  log(
    "本部が入力した氏名・住所・電話番号がアップロードのみ契約に記録される",
    partyRow === "アップロード太郎|東京都港区3-3-3|090-5555-6666",
  );

  await admin.waitForTimeout(500);
  const panelText = await panel.textContent();
  log("スタッフ詳細の現在の契約に「書面アップロード」の注記が出る", panelText.includes("書面アップロード"));

  // open the read-only detail view and confirm the uploaded document link shows
  await panel.getByRole("button", { name: "詳細確認" }).first().click();
  await admin.waitForTimeout(300);
  const detailModal = admin.locator("div.fixed.inset-0.z-30").last();
  log("詳細確認モーダルにアップロードされた書面へのリンクが表示される", await detailModal.getByText("アップロードされた署名済み書面を見る").isVisible());
  await detailModal.locator("text=✕").click();
  await admin.waitForTimeout(300);

  // --- sanity check: normal mode (no upload) still behaves as before ---
  await panel.getByRole("button", { name: "＋契約書を生成" }).click();
  await admin.waitForTimeout(200);
  const chooseModal2 = admin.locator("div.fixed.inset-0.z-30").last();
  const ackCheckbox = chooseModal2.locator('input[type="checkbox"]');
  if ((await ackCheckbox.count()) > 0) await ackCheckbox.check();
  await chooseModal2.locator("select").selectOption({ label: "アルバイト・フロント業務" });
  await chooseModal2.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  const assignModal2 = admin.locator("div.fixed.inset-0.z-30").last();
  await assignModal2.getByRole("button", { name: "内容を編集して専用の契約書を作る" }).click();
  await admin.waitForTimeout(300);
  const genModal2 = admin.locator("div.fixed.inset-0.z-30").last();
  // leave the toggle on its default (通常通り生成してスタッフに同意してもらう) and submit
  await genModal2.getByRole("button", { name: "生成する" }).click();
  await admin.waitForTimeout(1000);

  const newestStatus = psql(
    `select status from "StaffContract" where "staffUserId"='${proxyUserId}' order by "createdAt" desc limit 1;`,
  );
  log("通常モードでは引き続きPENDING_CONSENTで作成される（アップロードのみの追加で既存動作が壊れていない）", newestStatus === "PENDING_CONSENT");

  console.log(process.exitCode ? "CONTRACT UPLOAD-ONLY SMOKE TEST HAD FAILURES" : "CONTRACT UPLOAD-ONLY SMOKE TEST PASSED");
} catch (err) {
  console.error("CONTRACT UPLOAD-ONLY SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-contract-upload-only-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
