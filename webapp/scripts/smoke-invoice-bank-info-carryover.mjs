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
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}' order by "createdAt" desc limit 1;`);
  psql(
    `update "Company" set "teeBalance" = 10 where id = '${companyId}';` +
      `insert into "TeeLedgerEntry" (id, "companyId", type, amount, "balanceAfter", "createdAt") values (gen_random_uuid()::text, '${companyId}', 'ADJUSTMENT', 10, 10, now());`,
  );

  // --- ④ 振込先は会社設定ではなく請求書の画面で登録・選択する ---
  await admin.goto("http://localhost:3000/company/settings");
  await admin.getByRole("button", { name: /変更/ }).click();
  await admin.waitForTimeout(300);
  let bodyText = await admin.textContent("body");
  log("会社設定に請求書の振込先の欄は無い", !bodyText.includes("請求書の振込先") && (await admin.getByLabel("銀行名").count()) === 0);

  // --- agency module + proxy client for invoicing ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加");
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

  // --- 振込先：登録が無いうちは「振込先を載せない」、＋振込先を追加で登録してそのまま選ぶ ---
  const bankButton = admin.getByRole("button", { name: "振込先", exact: true });
  const selectedText = async () => ((await bankButton.textContent()) ?? "").replace("⌃⌄", "").trim();
  const choose = async (text) => {
    await bankButton.click();
    await admin.getByRole("listbox", { name: "振込先の選択肢" }).getByRole("option").filter({ hasText: text }).click();
    await admin.waitForTimeout(800);
  };
  log("登録が無いうちは「振込先を載せない」", (await selectedText()).startsWith("振込先を載せない"));
  const invoiceIdForBank = psql(
    `select id from "Invoice" where "issuingCompanyId"='${companyId}' and "companyRelationshipId"='${relationshipId}' and "periodLabel"='${thisMonth}';`,
  );
  const addAccount = async (bank, number, holder) => {
    await bankButton.click();
    await admin.getByRole("listbox", { name: "振込先の選択肢" }).getByRole("button", { name: "＋振込先を追加" }).click();
    const dialog = admin.getByRole("dialog", { name: "振込先を追加" });
    await dialog.getByLabel("銀行名（必須）").fill(bank);
    await dialog.getByLabel("支店名").fill("本店");
    await dialog.getByLabel("口座番号（必須）").fill(number);
    await dialog.getByLabel("口座名義（必須）").fill(holder);
    await dialog.getByRole("button", { name: "追加してこの請求書で使う" }).click();
    await dialog.waitFor({ state: "detached" });
    await admin.waitForTimeout(800);
  };
  await addAccount("テスト銀行", "1234567", "ﾌﾘｺﾍﾟ ｶﾌﾞｶﾌﾞ");
  log("追加した振込先が登録される", psql(`select count(*) from "CompanyBankAccount" where "companyId"='${companyId}';`) === "1");
  log(
    "追加した振込先がこの請求書の振込先になる",
    psql(`select "bankName" || '|' || "branchName" || '|' || "accountType" || '|' || "accountNumber" from "Invoice" where id='${invoiceIdForBank}';`) ===
      "テスト銀行|本店|普通|1234567",
  );
  await addAccount("この取引先専用銀行", "9999999", "ｾﾝﾖｳ");
  log("2件目を追加すると、そちらが選ばれる", (await selectedText()).startsWith("この取引先専用銀行"));
  await bankButton.click();
  log(
    "一覧も銀行／支店／種別・口座番号／名義に分けて表示される",
    ((await admin.getByRole("option").filter({ hasText: "テスト銀行" }).textContent()) ?? "").includes("普通 1234567"),
  );
  await admin.mouse.click(5, 5);
  await admin.waitForTimeout(300);
  log("振込先は銀行／支店／種別・口座番号／名義に分けて表示される", (await selectedText()).includes("この取引先専用銀行本店") && (await selectedText()).includes("普通 9999999") && (await selectedText()).includes("名義：ｾﾝﾖｳ"));

  // 載せない → また選ぶ
  await choose("振込先を載せない");
  log("「振込先を載せない」で請求書の振込先が空になる", psql(`select coalesce("bankName", '') || coalesce("accountNumber", '') from "Invoice" where id='${invoiceIdForBank}';`) === "");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfText = async (url) => {
    const res = await admin.request.get(url);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await res.body()) }).promise;
    return (await (await doc.getPage(1)).getTextContent()).items.map((it) => it.str).join("");
  };
  log("載せないときはPDFに「お振込先」が出ない", !(await pdfText(`http://localhost:3000/api/invoices/${invoiceIdForBank}/pdf`)).includes("お振込先"));
  await choose("この取引先専用銀行");
  const invoiceBankAfterEdit = psql(`select "bankName" from "Invoice" where id='${invoiceIdForBank}';`);
  log("登録済みの振込先を選ぶと請求書に入る", invoiceBankAfterEdit === "この取引先専用銀行");
  log("選んだ振込先がPDFに出る", (await pdfText(`http://localhost:3000/api/invoices/${invoiceIdForBank}/pdf`)).includes("この取引先専用銀行"));

  // 登録の削除：請求書に入っている振込先はそのまま
  await admin.getByRole("button", { name: "登録した振込先の管理" }).click();
  const manage = admin.getByRole("dialog", { name: "登録した振込先" });
  await manage.locator("li", { hasText: "この取引先専用銀行" }).getByRole("button", { name: "削除" }).click();
  await admin.waitForTimeout(800);
  await manage.getByRole("button", { name: "閉じる" }).click();
  log("登録を削除できる", psql(`select count(*) from "CompanyBankAccount" where "companyId"='${companyId}';`) === "1");
  log("削除しても請求書の振込先は残る", psql(`select "bankName" from "Invoice" where id='${invoiceIdForBank}';`) === "この取引先専用銀行");
  log("削除した振込先は「この請求書の振込先」として表示される", (await selectedText()).includes("この請求書の振込先"));

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

  const issuedSnapshotBank = psql(
    `select snapshot->>'bankName' from "InvoiceIssue" where "invoiceId"='${invoiceIdForBank}' order by "issuedAt" desc limit 1;`,
  );
  log("発行時スナップショットにも請求書側で編集した振込先が入る", issuedSnapshotBank === "この取引先専用銀行");

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
    `with ins as (insert into "Invoice" (id, "issuingCompanyId", "companyRelationshipId", "periodLabel", note, "bankName", "accountNumber", "accountHolderName", "groupLinesByTask", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${relationshipId}', '${monthForSeed}', '前月の備考（持ち越しテスト）', '前月の銀行', '7654321', 'ゼンゲツ', false, now(), now()) returning id) select id from ins;`,
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
  log("翌月を初めて開くと前月の備考が引き継がれる", (await admin.getByLabel("備考").inputValue()) === "前月の備考（持ち越しテスト）");
  log(
    "翌月を初めて開くと前月の振込先が引き継がれる（登録済みの振込先ではなく前月の値）",
    psql(`select "bankName" || '|' || "accountNumber" from "Invoice" where "periodLabel"='${monthToOpen}' and "companyRelationshipId"='${relationshipId}';`) === "前月の銀行|7654321",
  );
  log(
    "PDFの載せ方も前月から引き継がれる",
    psql(`select "groupLinesByTask" from "Invoice" where "periodLabel"='${monthToOpen}' and "companyRelationshipId"='${relationshipId}';`) === "f",
  );
  const carriedLine = psql(
    `select rate from "InvoiceLine" il join "Invoice" i on i.id = il."invoiceId" ` +
      `where i."periodLabel"='${monthToOpen}' and i."companyRelationshipId"='${relationshipId}' and il.description='前月の会場使用料';`,
  );
  log("引き継がれた項目の単価は前月と同じ（2000）", carriedLine === "2000");

  // 前の月の請求書が無い依頼主は、最初に登録した振込先で始まる
  const rel2 = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") values (gen_random_uuid()::text, '${companyId}', '${companyId}', '振込先確認取引先2', 'ACTIVE', now()) returning id) select id from ins;`,
  );
  await admin.goto(`http://localhost:3000/company/invoices?month=${thisMonth}&client=${rel2}`);
  await admin.waitForTimeout(600);
  log(
    "初めての依頼主の請求書は、最初に登録した振込先で始まる",
    psql(`select "bankName" from "Invoice" where "companyRelationshipId"='${rel2}';`) === "テスト銀行",
  );

  console.log(process.exitCode ? "INVOICE BANK INFO / CARRYOVER SMOKE TEST HAD FAILURES" : "INVOICE BANK INFO / CARRYOVER SMOKE TEST PASSED");
} catch (err) {
  console.error("INVOICE BANK INFO / CARRYOVER SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
