import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

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

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();
const staff = await (await browser.newContext()).newPage();

const adminEmail = `detail-admin-${Date.now()}@example.com`;
const staffEmail = `detail-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "詳細確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "詳細確認株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "詳細確認花子");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);
  const membershipId = psql(
    `select id from "CompanyMembership" where "userId"='${staffUserId}' and role='STAFF';`,
  );

  // base contract with distinctive fields for the 詳細確認 check
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("キャディ業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("DAILY");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("14000");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);
  await staff.goto("http://localhost:3000/staff/contracts");
  await staff.reload();
  await staff.getByRole("button", { name: "契約を結ぶ" }).click();
  await staff.waitForTimeout(600);

  // --- ① 詳細確認: read-only popup, no edit/save buttons
  await admin.goto("http://localhost:3000/company/roster");
  await admin.locator("tbody tr", { hasText: "詳細確認花子" }).click();
  await admin.waitForTimeout(300);
  const panel = admin.locator("div.fixed.inset-0.z-30").first();
  await panel.getByRole("button", { name: "契約書管理" }).click();
  await panel.getByRole("button", { name: "詳細確認" }).click();
  await admin.waitForTimeout(200);
  const detailModal = admin.locator("div.fixed.inset-0.z-30").last();
  const detailText = await detailModal.textContent();
  log("詳細確認ポップアップに業務内容が表示される", detailText.includes("キャディ業務"));
  log("詳細確認ポップアップに賃金が表示される", detailText.includes("14000円"));
  log("詳細確認ポップアップに編集ボタンが無い（閲覧専用）", !detailText.includes("内容を編集する") && !detailText.includes("更新する"));
  await detailModal.getByRole("button", { name: "✕" }).click();
  await admin.waitForTimeout(200);

  // --- ② 本人確認書類: 未提出表示 → 片面提出 → クリップリンク表示
  const idBefore = await panel.textContent();
  log("提出前は両面とも未提出と表示される", (idBefore.match(/未提出/g) || []).length >= 2);

  psql(
    `update "CompanyMembership" set "idDocumentFrontUrl"='https://example.com/id-front.jpg' where id='${membershipId}';`,
  );
  await admin.goto("http://localhost:3000/company/roster");
  await admin.locator("tbody tr", { hasText: "詳細確認花子" }).click();
  await admin.waitForTimeout(300);
  const panel2 = admin.locator("div.fixed.inset-0.z-30").last();
  await panel2.getByRole("button", { name: "契約書管理" }).click();
  const idAfter = await panel2.textContent();
  log("表面提出後はクリップリンクが表示される", idAfter.includes("📎"));
  log("裏面はまだ未提出のまま", (idAfter.match(/未提出/g) || []).length === 1);
  const frontLinkHref = await panel2.locator("a", { hasText: "画像を見る" }).getAttribute("href");
  log("クリップリンクのURLが正しい", frontLinkHref === "https://example.com/id-front.jpg");

  // --- ③ 振込先情報（会社側）: 未設定 → 編集 → 保存 → 表示反映
  log("初期状態は振込先情報が未設定", (await panel2.textContent()).includes("未設定"));
  await panel2.getByRole("button", { name: "登録" }).click();
  await admin.waitForTimeout(200);
  const bankPopup = admin.locator("div.fixed.inset-0.z-40").last();
  await bankPopup.locator("label", { hasText: "銀行名" }).locator("input").fill("テスト銀行");
  await bankPopup.locator("label", { hasText: "支店名" }).locator("input").fill("本店");
  await bankPopup.locator("label", { hasText: "口座種別" }).locator("select").selectOption("普通");
  await bankPopup.locator("label", { hasText: "口座番号" }).locator("input").fill("1234567");
  await bankPopup.locator("label", { hasText: "口座名義" }).locator("input").fill("シヨウサイカクニンハナコ");
  await bankPopup.getByRole("button", { name: "保存" }).click();
  await admin.waitForTimeout(500);

  const bankRowAfter = psql(
    `select "bankName", "branchName", "accountType", "accountNumber", "accountHolderName" from "CompanyMembership" where id='${membershipId}';`,
  );
  log(
    "会社側の編集がDBに反映される",
    bankRowAfter === "テスト銀行|本店|普通|1234567|シヨウサイカクニンハナコ",
  );
  const panelTextAfterBank = await admin.locator("div.fixed.inset-0.z-30").last().textContent();
  log("会社側の画面に振込先情報が表示される", panelTextAfterBank.includes("テスト銀行") && panelTextAfterBank.includes("1234567"));

  // --- ④ 振込先情報（スタッフ側）: 自分で上書きできる
  await staff.goto("http://localhost:3000/staff/contracts");
  await staff.waitForTimeout(300);
  const staffBankSection = staff.locator("section", { hasText: "振込先情報" });
  log("スタッフ側にも会社が入力した振込先が表示される", (await staffBankSection.locator('input').first().inputValue()) === "テスト銀行");

  await staffBankSection.locator("label", { hasText: "支店名" }).locator("input").fill("スタッフ支店");
  await staffBankSection.getByRole("button", { name: "保存する" }).click();
  await staff.waitForTimeout(600);

  const bankRowAfterStaffEdit = psql(`select "branchName" from "CompanyMembership" where id='${membershipId}';`);
  log("スタッフ側からの編集もDBに反映される", bankRowAfterStaffEdit === "スタッフ支店");

  // --- ⑤ 本人確認書類（スタッフ側）: 既存画像がImageDropzoneに表示される
  await staff.reload();
  await staff.waitForTimeout(300);
  const idSection = staff.locator("section", { hasText: "本人確認書類" });
  const frontImgSrc = await idSection.locator("img").first().getAttribute("src");
  log("スタッフ側の本人確認書類欄に既存の表面画像が表示される", frontImgSrc === "https://example.com/id-front.jpg");

  // --- ⑥ regression: normal template create/edit/preview flow still works (readOnly not passed)
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  const createModal = admin.locator("div.fixed.inset-0.z-30").last();
  log("通常の新規作成では編集/プレビューの切り替えボタンがある", (await createModal.textContent()).includes("プレビュー"));
  await createModal.getByRole("button", { name: "✕" }).click();

  console.log(
    process.exitCode
      ? "CONTRACT DETAIL / ID DOC / BANK INFO SMOKE TEST HAD FAILURES"
      : "CONTRACT DETAIL / ID DOC / BANK INFO SMOKE TEST PASSED",
  );
} catch (err) {
  console.error("CONTRACT DETAIL / ID DOC / BANK INFO SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-contract-detail-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-contract-detail-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
