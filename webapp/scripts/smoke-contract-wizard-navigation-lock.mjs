import { execSync } from "node:child_process";
import { chromium } from "playwright-core";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";
import { openContractSignStep, submitContractConsent } from "./_lib/contractConsent.mjs";

// 身分証・振込先の必須化（既定でオン）とは関係ない確認なので、この確認で作った会社では必須を外す
// （外すと、以前と同じく「契約内容の確認 → 身分証 → 振込先」の順になる）
function disableRequiredDocuments() {
  execSync(
    `PGPASSWORD=postgres psql -h localhost -U postgres -d teera -c "update \\"ContractTemplate\\" set \\"requireIdDocument\\"=false, \\"requireBankInfo\\"=false where \\"createdAt\\" > now() - interval '30 minutes';"`,
  );
}

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
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
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
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
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

  // 確認待ちの契約書がある間は、どの画面でも閉じられないポップアップが出る
  const popup = staff.getByRole("dialog", { name: "新しい契約書が届いています" });
  await staff.goto("http://localhost:3000/staff/timecard");
  await popup.waitFor({ timeout: 15000 });
  log("確認待ちの契約書がある間は、ほかの画面でポップアップが出る", (await popup.innerText()).includes("ほかの画面は使えません"));
  await staff.goto("http://localhost:3000/staff");
  await popup.waitFor({ timeout: 15000 });
  log("ホームでもポップアップが出る", (await popup.innerText()).includes("離脱防止株式会社"));
  log("ポップアップに✕（閉じるボタン）は無い", (await popup.getByRole("button", { name: /✕|閉じる/ }).count()) === 0);
  await staff.goto("http://localhost:3000/staff/recruitments");
  await popup.waitFor({ timeout: 15000 });
  log("募集の画面でもポップアップが出る", true);

  // ポップアップのボタンから契約書の画面へ（契約書の画面ではポップアップを出さない）
  disableRequiredDocuments();
  // 登録済みの住所・電話番号（同意の欄に最初から入っているかを確かめる）
  execSync(
    `PGPASSWORD=postgres psql -h localhost -U postgres -d teera -c "update \\"User\\" set address='東京都品川区1-1-1', \\"phoneNumber\\"='03-1111-2222' where email='${staffEmail}';"`,
  );
  // ポップアップのボタンで、画面を移らずにその場で契約書の流れが開く
  const consentModal = await openContractSignStep(staff);
  log("ボタンでその場で契約書が開く（画面は移らない）", staff.url().endsWith("/staff/recruitments"));
  await consentModal.locator('label:has-text("氏名") input').fill("離脱防止花子");
  log(
    "登録済みの住所・電話番号が最初から入っている",
    (await consentModal.locator('label:has-text("住所") input').inputValue()) === "東京都品川区1-1-1" &&
      (await consentModal.locator('label:has-text("電話番号") input').inputValue()) === "03-1111-2222",
  );
  // 手直しもできる（直した内容は登録済みの住所にも反映される）
  await consentModal.locator('label:has-text("住所") input').fill("東京都品川区6-6-6");
  // 同意の処理（控えのPDF・メール・住所の反映）が終わって閉じるまで待つ
  await submitContractConsent(staff, consentModal);

  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.waitForTimeout(800);
  const savedAddress = execSync(
    `PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "select address from \\"User\\" where email='${staffEmail}';"`,
  )
    .toString()
    .trim();
  log("同意のときに直した住所が登録済みの住所にも反映される", savedAddress === "東京都品川区6-6-6");
  log("同意後はポップアップが出ない", staff.url().includes("/staff/timecard") && (await popup.count()) === 0);

  console.log(process.exitCode ? "CONTRACT WIZARD NAVIGATION LOCK SMOKE TEST HAD FAILURES" : "CONTRACT WIZARD NAVIGATION LOCK SMOKE TEST PASSED");
} catch (err) {
  console.error("CONTRACT WIZARD NAVIGATION LOCK SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-navlock-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-navlock-staff-failure.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
