import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 身分証・振込先の提出を必須にする（契約書テンプレートごとの設定。既定でオン）：
// ・未提出のスタッフは、ホームに「登録してください」が出て、アイコンの数字にも数える
// ・本部のダッシュボードに「書類未提出」とその一覧が出る
// ・契約書の手続きは、必須の書類が先（身分証→振込先→契約内容の確認・同意）
// ・テンプレートの編集で必須を外すと、未提出として出なくなる
// ・契約書がまだないスタッフには、お願いを出さない

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`)
    .toString()
    .trim()
    .split("\n")[0];
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();
const staff = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const suffix = Date.now();
const companyName = `書類確認株式会社${suffix}`;
const staffEmail = `docs-staff-${suffix}@example.com`;
const badge = async (page) => (await (await page.request.get("http://localhost:3000/api/app-badge")).json()).count;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "書類本部");
  await admin.fill("#email", `docs-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  // スタッフを招待して参加させる
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "書類スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // 同意待ちの契約書を用意する
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  // 契約書がまだないうちは、お願いは出さない
  await staff.goto("http://localhost:3000/staff");
  await staff.waitForTimeout(800);
  log("契約書がまだないスタッフには、ホームに登録のお願いを出さない", (await staff.getByText("を登録してください").count()) === 0);

  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  log(
    "テンプレート作成画面に必須のチェックがあり、既定はどちらもオン",
    (await admin.getByLabel("身分証（両面）の提出を必須にする").isChecked()) &&
      (await admin.getByLabel("振込先の登録を必須にする").isChecked()),
  );
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("受付業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1200");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);
  const templateId = psql(`select id from "ContractTemplate" where "companyId"='${companyId}' order by "createdAt" desc limit 1;`);
  log("作ったテンプレートは身分証・振込先とも必須", psql(`select "requireIdDocument" || '|' || "requireBankInfo" from "ContractTemplate" where id='${templateId}';`) === "true|true");
  psql(
    `insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", status, "createdAt", "updatedAt") values (gen_random_uuid()::text, '${templateId}', '${staffUserId}', 1200, 'PENDING_CONSENT', now(), now());`,
  );

  // --- スタッフ：ホームに登録のお願い、アイコンの数字（契約書1＋身分証1＋振込先1） ---
  await staff.goto("http://localhost:3000/staff");
  const banner = staff.getByText("身分証・振込先を登録してください");
  await banner.waitFor({ timeout: 15000 });
  log("スタッフのホームに「身分証・振込先を登録してください」が出る", await banner.isVisible());
  log("アイコンの数字に未提出の書類も数える（契約書1＋身分証1＋振込先1）", (await badge(staff)) === 3);

  // --- 本部：ダッシュボードに書類未提出 ---
  await admin.goto("http://localhost:3000/company");
  const card = admin.locator("button", { hasText: "書類未提出" }).first();
  await card.waitFor();
  log("ダッシュボードに「書類未提出 1件」", (await card.innerText()).replace(/\s/g, "").includes("書類未提出1"));
  await card.click();
  const popup = admin.locator("div.fixed.inset-0", { hasText: "身分証・振込先がまだ登録されていないスタッフです" }).last();
  log("一覧に名前と足りない書類が出る", (await popup.innerText()).includes("書類スタッフ") && (await popup.innerText()).includes("振込先"));

  // --- スタッフ：契約書の手続きは身分証→振込先→確認の順 ---
  await staff.goto(`http://localhost:3000/staff/contracts/${companyId}`);
  await staff.getByText("本人確認書類を提出").first().waitFor({ timeout: 15000 });
  let body = await staff.textContent("body");
  log("最初の手続きは① 本人確認書類の提出（契約内容の確認より先）", body.includes("① 本人確認書類を提出") && body.includes("契約書に同意する前に提出が必要"));

  // 身分証を出した（ことにする）→ 振込先 → 確認・同意
  psql(`update "CompanyMembership" set "idDocumentFrontUrl"='https://example.com/f.png', "idDocumentBackUrl"='https://example.com/b.png' where "userId"='${staffUserId}' and "companyId"='${companyId}';`);
  await staff.reload();
  await staff.getByText("② 振込先情報を入力").waitFor({ timeout: 15000 });
  log("身分証が済んでいれば② 振込先から始まる", true);
  const wizard = staff.locator("section.border-primary");
  await wizard.locator('label:has-text("銀行名") input').fill("書類銀行");
  await wizard.locator('label:has-text("支店名") input').fill("本店");
  await wizard.locator('label:has-text("口座番号") input').fill("1234567");
  await wizard.locator('label:has-text("口座名義") input').fill("ショルイ スタッフ");
  await wizard.getByRole("button", { name: "次へ" }).click();
  await staff.getByText("③ 契約内容を確認").waitFor({ timeout: 15000 });
  log("振込先を入れると③ 契約内容の確認に進む", true);
  await staff.getByRole("button", { name: "契約書の全文を確認する" }).click();
  const consentModal = staff.locator("div.fixed.inset-0.z-30").last();
  await consentModal.locator('label:has-text("氏名") input').fill("書類スタッフ");
  await consentModal.locator('label:has-text("住所") input').fill("東京都港区1-1-1");
  await consentModal.locator('label:has-text("電話番号") input').fill("090-0000-1111");
  await consentModal.getByRole("button", { name: "内容を確認しました（同意する）" }).click();
  await staff.getByText("④ 完了").waitFor({ timeout: 15000 });
  log("書類がそろえば契約書に同意できる", psql(`select status from "StaffContract" where "staffUserId"='${staffUserId}';`) === "ACTIVE");

  await staff.goto("http://localhost:3000/staff");
  await staff.waitForTimeout(500);
  log("書類がそろうとホームの登録のお願いは消える", (await staff.getByText("を登録してください").count()) === 0);
  log("アイコンの数字も0になる", (await badge(staff)) === 0);

  // --- テンプレートで必須を外すと、未提出として出ない ---
  // （このテンプレートは同意済みで使用中なので、編集すると複製ができる。新しい契約書をその複製で用意する）
  psql(`update "CompanyMembership" set "idDocumentFrontUrl"=null, "idDocumentBackUrl"=null, "bankName"=null where "userId"='${staffUserId}' and "companyId"='${companyId}';`);
  psql(`update "StaffContract" set status='ENDED' where "staffUserId"='${staffUserId}';`);
  psql(`update "ContractTemplate" set status='ACTIVE' where id='${templateId}';`);
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "編集", exact: true }).first().click();
  await admin.getByLabel("身分証（両面）の提出を必須にする").uncheck();
  await admin.getByLabel("振込先の登録を必須にする").uncheck();
  await admin.getByRole("button", { name: "更新する" }).click();
  await admin.waitForTimeout(800);
  log("テンプレートの編集で必須を外せる", psql(`select "requireIdDocument" || '|' || "requireBankInfo" from "ContractTemplate" where id='${templateId}';`) === "false|false");
  psql(
    `insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", status, "createdAt", "updatedAt") values (gen_random_uuid()::text, '${templateId}', '${staffUserId}', 1200, 'PENDING_CONSENT', now(), now());`,
  );
  await staff.goto("http://localhost:3000/staff");
  await staff.waitForTimeout(500);
  log("必須でなければ、未提出でもホームに出ない", (await staff.getByText("を登録してください").count()) === 0);
  await admin.goto("http://localhost:3000/company");
  const card2 = admin.locator("button", { hasText: "書類未提出" }).first();
  await card2.waitFor();
  log("必須でなければ、ダッシュボードも0件", (await card2.innerText()).replace(/\s/g, "").includes("書類未提出0"));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(process.exitCode ? "REQUIRED DOCUMENTS SMOKE TEST FAILED" : "REQUIRED DOCUMENTS SMOKE TEST PASSED");
