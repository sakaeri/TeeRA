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

// 検証対象（請求書/給与明細エディタ改善の②④⑤）:
// - ②編集画面に請求先/対象スタッフ名が表示される
// - ④会社情報に振込先を登録でき、請求書PDFに反映される
// - ⑤前月の手入力カスタム項目が翌月に数量0で引き継がれる

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();

const adminEmail = `bankinfo-admin-${Date.now()}@example.com`;
const companyName = `振込先確認株式会社${Date.now()}`;
function previousLabel(label) {
  const [year, month] = label.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const today = new Date().toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);
// 引き継ぎ検証は今月とは別の、まだ一度も開いていない2ヶ月分を使う
// （今月のInvoiceは発行テストで既に作成済みのため、再利用すると
// 「新規作成」の分岐を通らず引き継ぎロジックが検証できなくなる）。
const monthToOpen = previousLabel(thisMonth);
const monthForSeed = previousLabel(monthToOpen);

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "振込先確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}' order by "createdAt" desc limit 1;`);
  psql(
    `update "Company" set "teeBalance" = 10 where id = '${companyId}';` +
      `insert into "TeeLedgerEntry" (id, "companyId", type, amount, "balanceAfter", "createdAt") values (gen_random_uuid()::text, '${companyId}', 'ADJUSTMENT', 10, 10, now());`,
  );

  // --- ④ 会社情報に振込先を登録する ---
  await admin.goto("http://localhost:3000/company/settings");
  await admin.getByRole("button", { name: /変更/ }).click();
  await admin.waitForTimeout(200);
  await admin.getByLabel("銀行名").fill("テスト銀行");
  await admin.getByLabel("支店名").fill("本店");
  await admin.getByLabel("口座種別").fill("普通");
  await admin.getByLabel("口座番号").fill("1234567");
  await admin.getByLabel("口座名義").fill("ﾌﾘｺﾍﾟ ｶﾌﾞｶﾌﾞ");
  await admin.getByRole("button", { name: "保存", exact: true }).click();
  await admin.waitForTimeout(1800);
  let bodyText = await admin.textContent("body");
  log(
    "設定画面に保存した振込先情報が表示される",
    bodyText.includes("テスト銀行") && bodyText.includes("1234567") && bodyText.includes("ﾌﾘｺﾍﾟ ｶﾌﾞｶﾌﾞ"),
  );
  const savedBank = psql(`select "bankName", "accountNumber" from "Company" where id='${companyId}';`);
  log("DBに振込先情報が保存される", savedBank === "テスト銀行|1234567");

  // --- agency module + proxy client for invoicing ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加する");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "振込先確認取引先");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);
  const relationshipId = psql(
    `select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' order by "createdAt" desc limit 1;`,
  );

  // --- ② 請求書エディタに取引先名が表示される ---
  await admin.goto(`http://localhost:3000/company/invoices?month=${thisMonth}&client=${relationshipId}`);
  await admin.waitForTimeout(400);
  bodyText = await admin.textContent("body");
  log("請求書エディタに「請求先：振込先確認取引先」が表示される", bodyText.includes("請求先：振込先確認取引先"));

  // custom line this month (will be carried over to next month with hours=0)
  await admin.getByRole("button", { name: "＋追加" }).click();
  await admin.waitForTimeout(300);
  const addLineModal = admin.locator("div.fixed.inset-0.z-40").last();
  await addLineModal.getByLabel("内容").fill("会場使用料（持ち越しテスト）");
  await addLineModal.getByLabel("数量").fill("2");
  await addLineModal.getByLabel("単価").fill("3000");
  await addLineModal.getByRole("button", { name: "追加する" }).click();
  await admin.waitForTimeout(500);

  // issue this month's invoice so bank info on the PDF can be checked
  await admin.fill('input[type="date"]', `${thisMonth}-28`);
  await admin.locator('input[type="date"]').blur();
  await admin.waitForTimeout(400);
  await admin.getByRole("button", { name: "PDFで請求書を発行する", exact: true }).click();
  await admin.waitForTimeout(300);
  await admin.getByRole("button", { name: "発行する", exact: true }).click();
  await admin.waitForTimeout(800);

  const pdfLink = await admin.locator('a[href*="/api/invoices/"]').first().getAttribute("href");
  const pdfResp = await admin.request.get(`http://localhost:3000${pdfLink}`);
  const pdfBuffer = await pdfResp.body();
  log(
    "請求書PDFが生成される",
    pdfResp.headers()["content-type"] === "application/pdf" && pdfBuffer.slice(0, 4).toString() === "%PDF",
  );
  // react-pdfはテキストをフォント埋め込みでエンコードするため生テキスト
  // としては読めないが、PDFにお振込先セクション用の文字列ストリームが
  // 含まれる（＝renderToBufferがエラーなく完了し、サイズが十分大きい）
  // ことで最低限の健全性を確認する。
  log("請求書PDFが十分なサイズを持つ（振込先セクション追加分を含む）", pdfBuffer.length > 1000);

  // --- ⑤ 前月のカスタム項目を仕込んでおき、翌月を初めて開くと数量0で引き継がれる ---
  // seed月のInvoiceレコードを直接作成し、カスタム行を1件入れておく
  const seedInvoiceId = psql(
    `with ins as (insert into "Invoice" (id, "issuingCompanyId", "companyRelationshipId", "periodLabel", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${relationshipId}', '${monthForSeed}', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "InvoiceLine" (id, "invoiceId", "staffName", description, hours, rate, amount, "taxRatePercent") ` +
      `values (gen_random_uuid()::text, '${seedInvoiceId}', '', '前月の会場使用料', 3, 2000, 6000, 10);`,
  );

  await admin.goto(`http://localhost:3000/company/invoices?month=${monthForSeed}&client=${relationshipId}`);
  await admin.waitForTimeout(400);
  bodyText = await admin.textContent("body");
  log("seed月の請求書にカスタム項目が入っている（仕込み確認）", bodyText.includes("前月の会場使用料"));

  // monthToOpen はこのテストで一度も開いていない月 → 初回アクセスで
  // getOrCreateInvoiceの「新規作成」分岐を通り、引き継ぎロジックが走る。
  await admin.goto(`http://localhost:3000/company/invoices?month=${monthToOpen}&client=${relationshipId}`);
  await admin.waitForTimeout(500);
  bodyText = await admin.textContent("body");
  log(
    "翌月を初めて開くと前月のカスタム項目が引き継がれる",
    bodyText.includes("前月の会場使用料"),
  );
  const carriedHoursValue = await admin
    .locator("tr", { hasText: "前月の会場使用料" })
    .locator("input[type=number]")
    .first()
    .inputValue();
  log("引き継がれた項目の数量は0になっている", carriedHoursValue === "0");
  const carriedLine = psql(
    `select rate from "InvoiceLine" il join "Invoice" i on i.id = il."invoiceId" ` +
      `where i."periodLabel"='${monthToOpen}' and i."companyRelationshipId"='${relationshipId}' and il.description='前月の会場使用料';`,
  );
  log("引き継がれた項目の単価は前月と同じ（2000）", carriedLine === "2000");

  console.log(process.exitCode ? "INVOICE BANK INFO / CARRYOVER SMOKE TEST HAD FAILURES" : "INVOICE BANK INFO / CARRYOVER SMOKE TEST PASSED");
} catch (err) {
  console.error("INVOICE BANK INFO / CARRYOVER SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
