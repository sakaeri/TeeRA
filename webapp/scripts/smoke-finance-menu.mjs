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

// 「給料明細/請求書」メニューの検証:
// - サイドバーに1つのメニュー項目としてまとまり、給与計算/請求書どちらの
//   ページにいてもハイライトされる
// - 各ページの先頭に「給料明細」「請求書」のタブがあり、切り替えられる
// - 発行履歴セクションには「発行済み（課金済み）」のものだけが月ごとに
//   並び、下書き中のものは出ない

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const todayJstStr = new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10);
const thisMonth = todayJstStr.slice(0, 7);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();

const adminEmail = `fm-admin-${Date.now()}@example.com`;
const companyName = `給料明細請求書メニュー確認株式会社${Date.now()}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "メニュー確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  // --- 給料明細: 発行済みスタッフ1名 + 下書き中スタッフ1名 ---
  psql(
    `insert into "User" (id, email, "passwordHash", name, "updatedAt") ` +
      `values (gen_random_uuid()::text, 'fm-issued-staff-${Date.now()}@example.com', 'x', '発行済み給与スタッフ', now());`,
  );
  const issuedStaffId = psql(`select id from "User" where name='発行済み給与スタッフ' order by "createdAt" desc limit 1;`);
  psql(
    `insert into "CompanyMembership" (id, "userId", "companyId", role, "createdAt") ` +
      `values (gen_random_uuid()::text, '${issuedStaffId}', '${companyId}', 'STAFF', now());`,
  );
  const issuedSlipId = psql(
    `with ins as (insert into "SalarySlip" (id, "companyId", "staffUserId", "targetMonth", status, "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${issuedStaffId}', '${thisMonth}', 'ISSUED', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "SalarySlipIssue" (id, "salarySlipId", snapshot, "chargedTee", "issuedAt") ` +
      `values (gen_random_uuid()::text, '${issuedSlipId}', '{}'::jsonb, true, now());`,
  );

  psql(
    `insert into "User" (id, email, "passwordHash", name, "updatedAt") ` +
      `values (gen_random_uuid()::text, 'fm-draft-staff-${Date.now()}@example.com', 'x', '下書き給与スタッフ', now());`,
  );
  const draftStaffId = psql(`select id from "User" where name='下書き給与スタッフ' order by "createdAt" desc limit 1;`);
  psql(
    `insert into "CompanyMembership" (id, "userId", "companyId", role, "createdAt") ` +
      `values (gen_random_uuid()::text, '${draftStaffId}', '${companyId}', 'STAFF', now());`,
  );
  psql(
    `insert into "SalarySlip" (id, "companyId", "staffUserId", "targetMonth", status, "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${draftStaffId}', '${thisMonth}', 'DRAFT', now(), now());`,
  );

  // --- 請求書: agencyEnabled化 + 発行済み依頼主1社 + 下書き中依頼主1社 ---
  psql(`update "Company" set "agencyEnabled" = true where id = '${companyId}';`);
  const issuedRelId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${companyId}', '発行済み請求依頼主', 'ACTIVE', now()) returning id) select id from ins;`,
  );
  const issuedInvoiceId = psql(
    `with ins as (insert into "Invoice" (id, "issuingCompanyId", "companyRelationshipId", "periodLabel", status, "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${issuedRelId}', '${thisMonth}', 'ISSUED', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "InvoiceIssue" (id, "invoiceId", snapshot, "issuedAt") ` +
      `values (gen_random_uuid()::text, '${issuedInvoiceId}', '{}'::jsonb, now());`,
  );

  const draftRelId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${companyId}', '下書き請求依頼主', 'ACTIVE', now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "Invoice" (id, "issuingCompanyId", "companyRelationshipId", "periodLabel", status, "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${draftRelId}', '${thisMonth}', 'DRAFT', now(), now());`,
  );

  // --- サイドバー: 「給料明細/請求書」が1つのメニュー項目になっている ---
  await admin.goto("http://localhost:3000/company");
  const navLabelCount = await admin.locator("nav a", { hasText: "給料明細/請求書" }).count();
  log("サイドバーに「給料明細/請求書」が1項目としてある", navLabelCount === 1);

  await admin.click("text=給料明細/請求書");
  await admin.waitForURL("http://localhost:3000/company/payroll");

  // --- 給料明細タブ: 発行履歴に発行済みだけが出る ---
  // 「スタッフ」選択欄には下書き中のスタッフも当然出るので、発行履歴
  // セクションに絞って確認する。
  let body = await admin.textContent("body");
  log("給料明細タブが選択されている", body.includes("給料明細") && body.includes("請求書"));
  const salaryHistorySection = admin.locator("section", { hasText: "発行履歴" });
  const salaryHistoryText = await salaryHistorySection.textContent();
  log("発行済みスタッフが発行履歴に出る", salaryHistoryText.includes("発行済み給与スタッフ"));
  log("下書き中スタッフは発行履歴に出ない", !salaryHistoryText.includes("下書き給与スタッフ"));

  const salaryPdfLink = salaryHistorySection.locator("a", { hasText: "PDF（" }).first();
  const salaryPdfHref = await salaryPdfLink.getAttribute("href");
  log("発行履歴のPDFリンクが正しいエンドポイントを指す", salaryPdfHref?.includes(`/api/salary-slips/${issuedSlipId}/pdf`));

  // --- タブ切り替えで請求書ページへ ---
  await admin.getByRole("link", { name: "請求書", exact: true }).click();
  await admin.waitForURL("http://localhost:3000/company/invoices");
  const invoiceHistorySection = admin.locator("section", { hasText: "発行履歴" });
  const invoiceHistoryText = await invoiceHistorySection.textContent();
  log("発行済み依頼主が発行履歴に出る", invoiceHistoryText.includes("発行済み請求依頼主"));
  log("下書き中の依頼主は発行履歴に出ない", !invoiceHistoryText.includes("下書き請求依頼主"));

  const invoicePdfLink = invoiceHistorySection.locator("a", { hasText: "PDF（" }).first();
  const invoicePdfHref = await invoicePdfLink.getAttribute("href");
  log("請求書の発行履歴PDFリンクが正しいエンドポイントを指す", invoicePdfHref?.includes(`/api/invoices/${issuedInvoiceId}/pdf`));

  // --- サイドバーは請求書ページでも「給料明細/請求書」がハイライトされたまま ---
  const navItem = admin.locator("nav a", { hasText: "給料明細/請求書" });
  const navItemClass = await navItem.getAttribute("class");
  log("請求書ページでもサイドバーの「給料明細/請求書」がアクティブ表示になる", navItemClass?.includes("font-semibold"));

  console.log(process.exitCode ? "FINANCE MENU SMOKE TEST HAD FAILURES" : "FINANCE MENU SMOKE TEST PASSED");
} catch (err) {
  console.error("FINANCE MENU SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-finance-menu-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
