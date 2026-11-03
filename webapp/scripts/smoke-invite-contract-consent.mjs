import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 契約書テンプレートを付けた招待で参加しても、同意したことにはならない：
// ・参加した時点の契約書は「確認待ち」（同意日時なし）
// ・スタッフは契約書の画面から出られず、必須の身分証から手続きが始まる
// ・身分証・振込先・氏名・住所・電話番号を入れて同意すると、その内容が記録される

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`)
    .toString()
    .split("\n")
    .filter((line) => !/^(INSERT|UPDATE|DELETE)\s/.test(line))
    .join("\n")
    .trim();
}


const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();
const staff = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const suffix = Date.now();
const companyName = `招待契約確認株式会社${suffix}`;
const staffEmail = `invite-contract-staff-${suffix}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "招待契約本部");
  await admin.fill("#email", `invite-contract-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  // 身分証・振込先とも必須のテンプレートを作る
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("受付業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1200");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);
  const templateId = psql(`select id from "ContractTemplate" where "companyId"='${companyId}' order by "createdAt" desc limit 1;`);

  // テンプレートを付けて招待する
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=本アカウントを招待");
  await admin.locator(`select:has(option[value="${templateId}"])`).selectOption(templateId);
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  log("招待にテンプレートが付いている", psql(`select "contractTemplateId" from "InviteToken" where "companyId"='${companyId}' order by "createdAt" desc limit 1;`) === templateId);

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "招待契約スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL(/\/staff/);
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);
  log(
    "参加しただけでは同意にならない（確認待ち・同意日時なし）",
    psql(`select status || '|' || coalesce("consentedAt"::text, '') from "StaffContract" where "staffUserId"='${staffUserId}';`) === "PENDING_CONSENT|",
  );

  // 契約書の画面から出られない
  await staff.goto("http://localhost:3000/staff");
  await staff.waitForURL(/\/staff\/contracts/, { timeout: 15000 });
  log("ホームを開いても契約書の画面に戻される", staff.url().includes("/staff/contracts"));
  await staff.goto(`http://localhost:3000/staff/contracts/${companyId}`);
  await staff.getByText("本人確認書類を提出").waitFor({ timeout: 15000 });
  log("必須の身分証から手続きが始まる", true);

  // 身分証は提出済みにして（アップロード先はローカルに無いため）、振込先 → 確認・同意
  psql(
    `update "CompanyMembership" set "idDocumentFrontUrl"='https://example.com/f.png', "idDocumentBackUrl"='https://example.com/b.png' where "userId"='${staffUserId}' and "companyId"='${companyId}';`,
  );
  await staff.reload();
  await staff.getByText("振込先情報を入力").waitFor();
  const field = (label) => staff.locator("label", { hasText: label }).locator("input");
  await field("銀行名").fill("テスト銀行");
  await field("口座番号").fill("1234567");
  await field("口座名義").fill("テスト タロウ");
  await staff.getByRole("button", { name: "次へ", exact: true }).click();
  await staff.getByRole("button", { name: "契約書の全文を確認する" }).click();
  const consentButton = staff.getByRole("button", { name: "内容を確認しました（同意する）" });
  const consentField = (label) => staff.locator("label", { hasText: label }).last().locator("input");
  await consentField("氏名").fill("招待契約スタッフ");
  log("住所・電話番号が空のうちは同意できない", await consentButton.isDisabled());
  await consentField("住所").fill("沖縄県那覇市1-1");
  await consentField("電話番号").fill("090-0000-0000");
  await consentButton.click();
  await staff.getByText("お疲れ様でした").waitFor({ timeout: 15000 });
  log(
    "同意すると氏名・住所・電話番号つきで記録される",
    psql(`select status || '|' || "partyAddress" || '|' || "partyPhoneNumber" || '|' || ("consentedAt" is not null) from "StaffContract" where "staffUserId"='${staffUserId}';`) ===
      "ACTIVE|沖縄県那覇市1-1|090-0000-0000|true",
  );

  console.log(process.exitCode ? "INVITE CONTRACT CONSENT SMOKE TEST HAD FAILURES" : "INVITE CONTRACT CONSENT SMOKE TEST PASSED");
} catch (err) {
  console.error("INVITE CONTRACT CONSENT SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
