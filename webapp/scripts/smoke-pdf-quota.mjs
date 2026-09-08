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

// PDF発行の無料枠（スタンダード月30件・給与明細＋請求書の合算、JST暦月
// ベース、ロック無し）の検証:
// - 無料枠を29件使い切った状態から、給与明細の発行（30件目）は無料枠を
//   使い、countsAgainstQuota=trueになる（Teeは動かない）
// - 続く請求書の発行（31件目）は無料枠を使い切っているため1Tee課金され、
//   countsAgainstQuota=falseになる
// - 同月内の再発行は（既存ルールどおり）クォータも課金も発生せず無料のまま

const today = new Date().toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminEmail = `pdfquota-admin-${Date.now()}@example.com`;
const staffEmail = `pdfquota-staff-${Date.now()}@example.com`;
const companyName = `PDF無料枠確認株式会社${Date.now()}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "PDF無料枠確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}' order by "createdAt" desc limit 1;`);

  // スタッフを1名招待（給与明細発行のテスト用）
  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "PDF無料枠確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // agencyモジュール有効化＋代理クライアント（請求書発行のテスト用）
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加する");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "PDF無料枠確認取引先");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);
  const relationshipId = psql(
    `select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' order by "createdAt" desc limit 1;`,
  );

  // スタンダードへアップグレード（無料枠月30件）＋念のため10Tee付与
  psql(
    `update "Company" set "planTier" = 'STANDARD', "teeBalance" = 10, "invoiceRegistrationNumber" = 'T1234567890123' where id = '${companyId}';` +
      `insert into "TeeLedgerEntry" (id, "companyId", type, amount, "balanceAfter", "createdAt") values (gen_random_uuid()::text, '${companyId}', 'ADJUSTMENT', 10, 10, now());`,
  );

  // 無料枠を29件、当月分としてダミーで使い切っておく（ダミーUser×ダミー
  // SalarySlipを29件作り、それぞれにcountsAgainstQuota=trueの発行済み
  // 履歴を1件ずつ付ける）
  for (let i = 0; i < 29; i++) {
    const dummyUserId = psql(
      `with ins as (insert into "User" (id, email, "passwordHash", name, "createdAt", "updatedAt") ` +
        `values (gen_random_uuid()::text, 'pdfquota-dummy-${Date.now()}-${i}@example.com', 'x', 'ダミー${i}', now(), now()) returning id) select id from ins;`,
    );
    const dummySlipId = psql(
      `with ins as (insert into "SalarySlip" (id, "companyId", "staffUserId", "targetMonth", status, "createdAt", "updatedAt") ` +
        `values (gen_random_uuid()::text, '${companyId}', '${dummyUserId}', '${thisMonth}', 'ISSUED', now(), now()) returning id) select id from ins;`,
    );
    psql(
      `insert into "SalarySlipIssue" (id, "salarySlipId", snapshot, "chargedTee", "countsAgainstQuota", "issuedAt") ` +
        `values (gen_random_uuid()::text, '${dummySlipId}', '{}'::jsonb, false, true, now());`,
    );
  }
  const usedSoFar = Number(
    psql(
      `select count(*) from "SalarySlipIssue" ssi join "SalarySlip" ss on ss.id = ssi."salarySlipId" ` +
        `where ss."companyId"='${companyId}' and ssi."countsAgainstQuota" = true;`,
    ),
  );
  log("無料枠を29件ダミーで使い切った状態を仕込めた", usedSoFar === 29);

  // --- 給与計算ページで残り枠が1/30と表示される ---
  await admin.goto(`http://localhost:3000/company/payroll?month=${thisMonth}&staff=${staffUserId}`);
  await admin.waitForTimeout(300);
  let bodyText = await admin.textContent("body");
  log("給与計算ページに無料発行枠「残り1/30件」が表示される", bodyText.includes("残り1/30件"));
  log(
    "発行確認ダイアログの案内も無料枠を使う旨になる（1Tee課金の文言ではない）",
    !bodyText.includes("1Teeを課金して発行します"),
  );

  // --- 30件目（給与明細）: 無料枠を使い、Teeは動かない ---
  await admin.getByRole("button", { name: "PDFで明細を発行する", exact: true }).click();
  bodyText = await admin.textContent("body");
  log(
    "30件目の発行確認では無料枠を使う旨のメッセージが出る",
    bodyText.includes("今月の無料発行枠を使って発行します"),
  );
  await admin.getByRole("button", { name: "発行する", exact: true }).click();
  await admin.waitForTimeout(800);

  let balance = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("30件目の発行ではTeeが消費されない（10のまま）", balance === 10);
  const salarySlipId = psql(
    `select id from "SalarySlip" where "companyId"='${companyId}' and "staffUserId"='${staffUserId}' and "targetMonth"='${thisMonth}';`,
  );
  const slip30 = psql(
    `select "chargedTee", "countsAgainstQuota" from "SalarySlipIssue" where "salarySlipId"='${salarySlipId}' order by "issuedAt" desc limit 1;`,
  );
  log("30件目のSalarySlipIssueはchargedTee=false, countsAgainstQuota=true", slip30 === "f|t");

  // --- 請求書ページで残り枠が0/30と表示される ---
  await admin.goto(`http://localhost:3000/company/invoices?month=${thisMonth}&client=${relationshipId}`);
  await admin.waitForTimeout(300);
  bodyText = await admin.textContent("body");
  log("請求書ページに無料発行枠「残り0/30件」が表示される", bodyText.includes("残り0/30件"));

  // --- 31件目（請求書）: 無料枠が無いため1Tee課金される ---
  await admin.fill('input[type="date"]', `${thisMonth}-28`);
  await admin.locator("label:has-text('支払期限') button").click();
  await admin.waitForTimeout(400);
  await admin.getByRole("button", { name: "PDFで請求書を発行する", exact: true }).click();
  bodyText = await admin.textContent("body");
  log("31件目の発行確認では通常どおり1Tee課金の案内になる", bodyText.includes("1Teeを課金して発行します"));
  await admin.getByRole("button", { name: "発行する", exact: true }).click();
  await admin.waitForTimeout(800);

  balance = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("31件目の発行で1Tee課金される（10→9）", balance === 9);
  const invoiceId = psql(
    `select id from "Invoice" where "issuingCompanyId"='${companyId}' and "companyRelationshipId"='${relationshipId}' and "periodLabel"='${thisMonth}';`,
  );
  const invoiceIssue31 = psql(`select "countsAgainstQuota" from "InvoiceIssue" where "invoiceId"='${invoiceId}' order by "issuedAt" desc limit 1;`);
  log("31件目のInvoiceIssueはcountsAgainstQuota=false", invoiceIssue31 === "f");

  // --- 同月内の再発行は既存ルールどおり無料のまま（クォータも課金も発生しない） ---
  await admin.goto(`http://localhost:3000/company/invoices?month=${thisMonth}&client=${relationshipId}`);
  await admin.waitForTimeout(300);
  await admin.getByRole("button", { name: "PDFで請求書を再発行する（同月内は無料）", exact: true }).click();
  await admin.getByRole("button", { name: "発行する", exact: true }).click();
  await admin.waitForTimeout(800);

  balance = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("同月内の再発行はTeeが消費されない（9のまま）", balance === 9);
  const invoiceIssueReissue = psql(`select "countsAgainstQuota" from "InvoiceIssue" where "invoiceId"='${invoiceId}' order by "issuedAt" desc limit 1;`);
  log("再発行のInvoiceIssueもcountsAgainstQuota=false（無料枠を消費しない）", invoiceIssueReissue === "f");

  const balanceInvariant = Number(psql(`select sum(amount) from "TeeLedgerEntry" where "companyId"='${companyId}';`));
  log("teeBalanceが台帳合計と一致する（不変条件）", balance === balanceInvariant);

  console.log(process.exitCode ? "PDF QUOTA SMOKE TEST HAD FAILURES" : "PDF QUOTA SMOKE TEST PASSED");
} catch (err) {
  console.error("PDF QUOTA SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
