import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

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

// 上位プラン（プロ：月19,800円・PDF月500件、エンタープライズ：月39,800円・PDF無制限）の検証。

const today = new Date().toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminEmail = `plantier-admin-${Date.now()}@example.com`;
const staffEmail = `plantier-staff-${Date.now()}@example.com`;
const companyName = `上位プラン確認株式会社${Date.now()}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "上位プラン確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}' order by "createdAt" desc limit 1;`);

  // スタッフを1名招待（給与明細発行のテスト用）
  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "上位プラン確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // agencyモジュール有効化＋代理クライアント（請求書発行のテスト用）
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "上位プラン確認取引先");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);
  const relationshipId = psql(
    `select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' order by "createdAt" desc limit 1;`,
  );

  // --- エンタープライズ（PDF無制限）: Tee残高0でも発行でき、課金されない ---
  psql(`update "Company" set "planTier" = 'ENTERPRISE', "teeBalance" = 0 where id = '${companyId}';`);
  await admin.goto(`http://localhost:3000/company/payroll?month=${thisMonth}&staff=${staffUserId}`);
  await admin.waitForTimeout(500);
  let bodyText = await admin.textContent("body");
  log("給与計算ページに「PDF発行は無制限です」と出る", bodyText.includes("PDF発行は無制限です（エンタープライズプラン）"));
  log("無制限のプランではTee課金の文言は出ない", !bodyText.includes("1Teeを課金して発行します"));
  await admin.getByRole("button", { name: "PDFで明細を発行する", exact: true }).click();
  await admin.waitForTimeout(1000);
  const issued = psql(
    `select ssi."chargedTee" || '|' || ssi."countsAgainstQuota" from "SalarySlipIssue" ssi join "SalarySlip" ss on ss.id = ssi."salarySlipId" where ss."companyId"='${companyId}' and ss."staffUserId"='${staffUserId}' order by ssi."issuedAt" desc limit 1;`,
  );
  log("Tee残高0でも発行でき、Teeは課金されない", issued === "false|true" || issued === "f|t");
  log("Tee残高は0のまま", psql(`select "teeBalance" from "Company" where id='${companyId}';`) === "0");

  // --- プロ（月500件）: 発行済み1件を差し引いた残りが出る ---
  psql(`update "Company" set "planTier" = 'PRO' where id = '${companyId}';`);
  await admin.goto(`http://localhost:3000/company/invoices?month=${thisMonth}&client=${relationshipId}`);
  await admin.waitForTimeout(800);
  bodyText = await admin.textContent("body");
  log("プロプランでは無料発行枠が「残り499/500件」と出る", bodyText.includes("残り499/500件"));

  // --- プラン選択にプロ・エンタープライズが出る ---
  await admin.goto("http://localhost:3000/company/wallet");
  await admin.waitForTimeout(600);
  await admin.getByText("プランを選ぶ", { exact: true }).first().click();
  await admin.waitForTimeout(400);
  bodyText = await admin.textContent("body");
  log(
    "プラン選択にプロ（¥19,800・月500件）とエンタープライズ（¥39,800・無制限）が出る",
    bodyText.includes("プロプラン") && bodyText.includes("¥19,800 / 月") && bodyText.includes("エンタープライズプラン") && bodyText.includes("¥39,800 / 月") && bodyText.includes("PDF発行 無制限"),
  );

  // --- トップページの料金プラン ---
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto("http://localhost:3000/");
  await visitor.getByRole("button", { name: "料金プラン" }).first().click();
  await visitor.waitForTimeout(300);
  bodyText = await visitor.textContent("body");
  log(
    "トップページの料金プランにプロ・エンタープライズと規模の目安が出る",
    bodyText.includes("¥19,800 / 月") && bodyText.includes("¥39,800 / 月") && bodyText.includes("スタッフ300名・取引先200社規模の目安"),
  );

  console.log(process.exitCode ? "PLAN TIERS SMOKE TEST HAD FAILURES" : "PLAN TIERS SMOKE TEST PASSED");
} finally {
  await browser.close();
}
