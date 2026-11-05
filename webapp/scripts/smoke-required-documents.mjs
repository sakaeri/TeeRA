import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 身分証・振込先の提出を必須にする（契約書テンプレートごとの設定。既定でオン）：
// ・未提出のスタッフは、ホームに「登録してください」が出て、アイコンの数字にも数える
// ・本部のダッシュボードの「契約書未確認」のカードに合算され、その一覧に未提出の書類が出る
// ・契約書の手続きは、その場で 契約書の内容 → 身分証 → 振込先 → 署名 の順
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

  // --- 本部：ダッシュボードの「契約書未確認」に合算 ---
  await admin.goto("http://localhost:3000/company");
  log("「書類未提出」のカードは無い（6枚のまま）", (await admin.locator("button", { hasText: "書類未提出" }).count()) === 0);
  const card = admin.locator("button", { hasText: "契約書未確認" }).first();
  await card.waitFor();
  log(
    "同意待ちと書類未提出が同じ人なら、カードの数字は1人として数える",
    (await card.innerText()).replace(/\s/g, "").includes("契約書未確認1"),
  );
  await card.click();
  const popup = admin.locator("div.fixed.inset-0", { hasText: "身分証・振込先が未提出のスタッフです" }).last();
  await popup.waitFor();
  const popupText = await popup.innerText();
  log(
    "一覧に名前と足りない書類が出る",
    popupText.includes("書類スタッフ") && popupText.includes("身分証未提出") && popupText.includes("振込先未提出"),
  );

  // --- スタッフ：契約書の内容 → 身分証 → 振込先 → 署名 の順に、その場で進める ---
  await staff.goto(`http://localhost:3000/staff/contracts/${companyId}`);
  await staff.getByRole("button", { name: "契約書を確認する" }).click();
  const wizard = staff.getByRole("dialog", { name: "契約書の確認" });
  await wizard.waitFor({ timeout: 15000 });
  log("必須の書類がある契約書は4手順（1/4 契約書の内容から）", (await wizard.innerText()).includes("1/4 契約書の内容"));
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
  log(
    "2/4 身分証明書の添付：未提出のうちは次へ進めない",
    (await wizard.innerText()).includes("2/4 身分証明書の添付") && (await wizard.getByRole("button", { name: "次へ", exact: true }).isDisabled()),
  );

  // 身分証を出した（ことにする。アップロード先はローカルに無いため）→ 開き直すと提出済みとして読み込まれる
  psql(`update "CompanyMembership" set "idDocumentFrontUrl"='https://example.com/f.png', "idDocumentBackUrl"='https://example.com/b.png' where "userId"='${staffUserId}' and "companyId"='${companyId}';`);
  await wizard.getByRole("button", { name: "閉じる" }).click();
  await staff.waitForLoadState("load");
  await staff.getByRole("button", { name: "契約書を確認する" }).click();
  await wizard.waitFor({ timeout: 15000 });
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
  log("提出済みの身分証は「提出済み」として読み込まれる", (await wizard.innerText()).includes("提出済み"));
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
  await wizard.getByText("3/4 振込先情報").waitFor({ timeout: 15000 });
  await wizard.locator('label:has-text("銀行名") input').fill("書類銀行");
  await wizard.locator('label:has-text("支店名") input').fill("本店");
  await wizard.locator('label:has-text("口座番号") input').fill("1234567");
  await wizard.locator('label:has-text("口座名義") input').fill("ショルイ スタッフ");
  await wizard.getByRole("button", { name: "次へ", exact: true }).click();
  await wizard.getByText("4/4 署名").waitFor({ timeout: 15000 });
  log("振込先を入れると4/4 署名に進む", true);
  await wizard.locator('label:has-text("氏名") input').fill("書類スタッフ");
  await wizard.locator('label:has-text("住所") input').fill("東京都港区1-1-1");
  await wizard.locator('label:has-text("電話番号") input').fill("090-0000-1111");
  await wizard.getByRole("button", { name: "内容を確認しました（同意する）" }).click();
  await wizard.waitFor({ state: "detached", timeout: 30000 });
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
  const card2 = admin.locator("button", { hasText: "契約書未確認" }).first();
  await card2.waitFor();
  await card2.click();
  const popup2 = admin.locator("div.fixed.inset-0", { hasText: "身分証・振込先が未提出のスタッフです" }).last();
  await popup2.waitFor();
  log("必須でなければ、ダッシュボードの一覧にも未提出の書類は出ない", !(await popup2.innerText()).includes("身分証未提出"));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(process.exitCode ? "REQUIRED DOCUMENTS SMOKE TEST FAILED" : "REQUIRED DOCUMENTS SMOKE TEST PASSED");
