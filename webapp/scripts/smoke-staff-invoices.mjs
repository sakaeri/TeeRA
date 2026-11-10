import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 業務委託のスタッフから会社へ出す請求書：
// ・業務委託の契約がある人だけメニューに「請求書」が出る
// ・承認済みの業務報告から勤務の行が自動で入り、「その他の項目」（交通費など）を足して提出できる
// ・会社の一覧には金額を出さず、開く時に1件分（無料枠が無ければ1Tee）使う。開く前はPDFも見られない
// ・源泉徴収・消費税は会社がスタッフごとに決め、確認待ちの請求書の金額も計算し直す
// ・差し戻し→スタッフが直して再提出→もう一度開いても追加はかからない→承認
// ・その月の支払明細を発行済みのスタッフの請求書は、無料で開ける
// ・他の会社の人はPDFを見られない

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
function prevMonth() {
  const d = new Date(Date.now() + 9 * 3600e3);
  const p = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function registerCompany(page, name, email) {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "請求本部");
  await page.fill("#email", email);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", name);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  return psql(`select id from "Company" where name='${name}';`);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();
const staff = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const other = await (await browser.newContext()).newPage();
const suffix = Date.now();
const companyName = `請求書受取株式会社${suffix}`;
const month = prevMonth();

try {
  const companyId = await registerCompany(admin, companyName, `sinv-admin-${suffix}@example.com`);
  psql(`update "Company" set "teeBalance"=5 where id='${companyId}';`); // 無料プラン（無料枠0）＋5Tee

  // スタッフを招待して登録
  await admin.goto("http://localhost:3000/company/roster");
  await admin.getByText("＋スタッフを追加").first().click();
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "委託太郎");
  await staff.fill("#email", `sinv-staff-${suffix}@example.com`);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffId = psql(`select id from "User" where email='sinv-staff-${suffix}@example.com';`);

  // 業務委託ではない間は、メニューに請求書が出ない
  await staff.goto("http://localhost:3000/staff/contracts");
  log("業務委託の契約が無い人には「請求書」が出ない", (await staff.locator('a[href="/staff/invoices"]').count()) === 0);

  // 業務委託の契約（同意済み・時給1,200円）と、先月の承認済みの勤務2件（8時間・4時間30分）
  const tpl = psql(
    `insert into "ContractTemplate" (id, "companyId", title, "employmentType", "workplaceType", "jobDescription", "scheduleType", "wageType", "wageAmount", "contractPeriodType", "contractStartDate", status, "updatedAt") values (gen_random_uuid()::text, '${companyId}', '業務委託契約', 'CONTRACTOR', 'INHOUSE', 'キャディ', 'SHIFT', 'HOURLY', 1200, 'INDEFINITE', '2026-01-01', 'LOCKED', now()) returning id;`,
  );
  const contractId = psql(
    `insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", "contractStartDate", status, "consentedAt", "partyName", "partyAddress", "updatedAt") values (gen_random_uuid()::text, '${tpl}', '${staffId}', 1200, '2026-01-01', 'ACTIVE', now(), '委託 太郎', '東京都千代田区1-1', now()) returning id;`,
  );
  psql(`insert into "StaffContractWageVersion" (id, "staffContractId", "wageAmount", "effectiveFrom") values (gen_random_uuid()::text, '${contractId}', 1200, '2026-01-01');`);
  psql(`update "CompanyMembership" set "bankName"='テスト銀行', "branchName"='本店', "accountType"='普通', "accountNumber"='1234567', "accountHolderName"='イタク タロウ' where "userId"='${staffId}';`);
  const addShift = (day, minutes, approved = true) => {
    const shiftId = psql(
      `insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'INHOUSE', 'キャディ', '${month}-${day}', '08:00', '17:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id;`,
    );
    psql(
      `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "computedMinutes", "submittedAt", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${shiftId}', '${staffId}', 'WORKED', '${approved ? "APPROVED" : "PENDING"}', ${minutes}, now(), now(), now());`,
    );
  };
  addShift("05", 480);
  addShift("12", 270);
  addShift("20", 300, false); // 未承認は入らない

  // --- スタッフ：請求書を作って提出 ---
  await staff.goto("http://localhost:3000/staff/contracts");
  log("業務委託の契約がある人には「請求書」が出る", (await staff.locator('a[href="/staff/invoices"]').count()) > 0);
  // 一覧（会社画面の給料明細と同じ並び）から「＋新しく作成」で会社を選んで開く
  await staff.goto(`http://localhost:3000/staff/invoices?month=${month}`);
  await staff.getByTestId("staff-invoice-drafts").waitFor();
  await staff.getByRole("button", { name: "＋新しく作成" }).click();
  await staff.getByRole("button", { name: companyName }).click();
  await staff.getByRole("button", { name: "作成へ進む" }).click();
  const editor = staff.getByTestId("staff-invoice-editor");
  await editor.waitFor();
  const editorText = await editor.innerText();
  log("承認済みの勤務2件が自動で入る（8時間・4.5時間）", editorText.includes("8時間 × 1,200円") && editorText.includes("4.5時間 × 1,200円"));
  log("未承認の業務報告があることを知らせる", editorText.includes("まだ会社が承認していない業務報告が1件"));
  log("契約書の名前・住所と振込先が入っている", (await editor.locator("input").first().inputValue()) === "委託 太郎" && editorText.includes("テスト銀行"));
  log("合計（9,600＋5,400＝15,000円）", (await staff.getByTestId("staff-invoice-total").innerText()) === "15,000円");
  await staff.getByRole("button", { name: "＋その他の項目を足す" }).click();
  const itemForm = staff.getByTestId("staff-invoice-item-form");
  await itemForm.getByLabel("項目名").fill("交通費（電車）");
  await itemForm.getByLabel("数量").fill("2");
  await itemForm.getByLabel("単価（円）").fill("440");
  log("ポップアップで数量×単価の金額が出る", (await itemForm.innerText()).includes("880円"));
  await itemForm.getByRole("button", { name: "追加する" }).click();
  log("その他の項目を足すと合計に入る（2×440円）", (await staff.getByTestId("staff-invoice-total").innerText()) === "15,880円" && (await editor.innerText()).includes("2 × 440円"));
  // 住所は必須
  await editor.getByLabel("住所").fill("");
  staff.once("dialog", (d) => d.accept());
  await staff.getByRole("button", { name: "提出する", exact: true }).click();
  await staff.getByText("住所を入力してください").waitFor();
  log("住所が空だと提出できない", psql(`select count(*) from "StaffInvoice" where "staffUserId"='${staffId}' and status='SUBMITTED';`) === "0");
  await editor.getByLabel("住所").fill("東京都千代田区1-1");
  await editor.locator('input[placeholder="無ければ空欄のまま"]').fill("T123");
  staff.once("dialog", (d) => d.accept());
  await staff.getByRole("button", { name: "提出する", exact: true }).click();
  await staff.getByText("登録番号は「T」と13桁").waitFor();
  log("登録番号の形が違うと提出できない", psql(`select count(*) from "StaffInvoice" where "staffUserId"='${staffId}';`) === "0");
  await editor.locator('input[placeholder="無ければ空欄のまま"]').fill("T1234567890123");
  staff.once("dialog", (d) => d.accept());
  await staff.getByRole("button", { name: "提出する", exact: true }).click();
  await staff.getByText("請求書を提出しました").waitFor();
  const inv = psql(`select id||'|'||status||'|'||total||'|'||"expensesTotal" from "StaffInvoice" where "staffUserId"='${staffId}';`).split("|");
  const invoiceId = inv[0];
  log("提出すると確認待ちになり、金額が保存される", inv[1] === "SUBMITTED" && inv[2] === "15880" && inv[3] === "880");
  await staff.goto(`http://localhost:3000/staff/invoices?month=${month}`);
  log("一覧の「提出済み」に会社名・確認中・金額が出る", /請求書受取株式会社[\s\S]*確認中[\s\S]*15,880円/.test(await staff.getByTestId("staff-invoice-submitted").innerText()));
  await staff.goto(`http://localhost:3000/staff/invoices?company=${companyId}&month=${month}`);
  log("登録番号を覚えておく", psql(`select "invoiceRegistrationNumber" from "User" where id='${staffId}';`) === "T1234567890123");
  await staff.getByText("提出済みです。会社が確認するまでお待ちください。").waitFor();
  log("提出後は直せない（入力欄が無効）", await editor.locator('input[placeholder="無ければ空欄のまま"]').isDisabled());

  // --- 会社：開く前は金額もPDFも見えない ---
  await admin.goto(`http://localhost:3000/company/payroll?month=${month}`);
  const list = admin.getByTestId("received-staff-invoices");
  await list.waitFor();
  const listText = await list.innerText();
  log("一覧に届いた請求書（未開封）が出る", listText.includes("委託太郎") && listText.includes("未開封"));
  log("一覧には金額を出さない", !(await admin.locator("main").innerText()).includes("15,880"));
  const pdfBefore = await admin.request.get(`http://localhost:3000/api/staff-invoices/${invoiceId}/pdf`);
  log("開く前はPDFを見られない", pdfBefore.status() === 403);
  await admin.goto(`http://localhost:3000/company/payroll?month=${month}&staffInvoice=${invoiceId}`);
  log("開く前にURLを直接開いても中身は出ない", (await admin.getByTestId("received-staff-invoice").count()) === 0);

  // 開く（無料枠0なので1Tee）
  let confirmText = "";
  admin.once("dialog", (d) => {
    confirmText = d.message();
    d.accept();
  });
  await list.getByRole("button", { name: /委託太郎/ }).click();
  await admin.getByTestId("received-staff-invoice").waitFor();
  log("開く前に「1Teeを使います」と確かめる", confirmText.includes("1Teeを使います"));
  log("開くと1Tee減る", psql(`select "teeBalance" from "Company" where id='${companyId}';`) === "4");
  log("Teeの履歴に残る", psql(`select count(*) from "TeeLedgerEntry" where "companyId"='${companyId}' and type='CONSUME_STAFF_INVOICE_OPEN';`) === "1");
  const detailText = await admin.getByTestId("received-staff-invoice").innerText();
  log("開くと中身（金額・登録番号・振込先）が見える", detailText.includes("15,880円") && detailText.includes("T1234567890123") && detailText.includes("テスト銀行"));
  const pdfAfter = await admin.request.get(`http://localhost:3000/api/staff-invoices/${invoiceId}/pdf`);
  log("開いた後はPDFを見られる", pdfAfter.status() === 200 && (pdfAfter.headers()["content-type"] ?? "").includes("pdf"));

  // 源泉徴収を「する」にすると計算し直す（15,000×10.21%＝1,531円）
  await admin.getByLabel(/源泉徴収する/).click();
  await admin.getByText("源泉徴収税").first().waitFor();
  log("源泉徴収すると、確認待ちの請求書の金額を計算し直す（15,880−1,531＝14,349円）", psql(`select total||'|'||"withholdingAmount" from "StaffInvoice" where id='${invoiceId}';`) === "14349|1531");
  log("会社の設定（スタッフごと）として残る", psql(`select "contractorWithholding" from "CompanyMembership" where "userId"='${staffId}';`) === "t");

  // 差し戻す
  await admin.getByRole("button", { name: "差し戻す" }).click();
  await admin.getByPlaceholder(/差し戻す理由/).fill("交通費の区間を書いてください");
  await admin.getByRole("button", { name: "差し戻す" }).last().click();
  await admin.getByText("差し戻しました").waitFor();
  log("差し戻すと差し戻し中になる", psql(`select status from "StaffInvoice" where id='${invoiceId}';`) === "RETURNED");
  log("スタッフにお知らせが届く", psql(`select count(*) from "StaffNotice" where "staffUserId"='${staffId}' and message like '%請求書が差し戻されました%';`) === "1");

  // スタッフが直して再提出
  await staff.goto(`http://localhost:3000/staff/invoices?company=${companyId}&month=${month}`);
  const editor2 = staff.getByTestId("staff-invoice-editor");
  await editor2.waitFor();
  log("差し戻しの理由が見える", (await editor2.innerText()).includes("交通費の区間を書いてください"));
  log("源泉徴収が反映されている（会社の設定）", (await editor2.innerText()).includes("源泉徴収税"));
  await editor2.getByRole("button", { name: /交通費（電車）/ }).click();
  await staff.getByTestId("staff-invoice-item-form").getByLabel("項目名").fill("交通費（東京→品川 往復）");
  await staff.getByTestId("staff-invoice-item-form").getByRole("button", { name: "直す" }).click();
  staff.once("dialog", (d) => d.accept());
  await staff.getByRole("button", { name: "直して提出する" }).click();
  await staff.getByText("請求書を提出しました").waitFor();
  log("再提出すると確認待ちに戻る", psql(`select status from "StaffInvoice" where id='${invoiceId}';`) === "SUBMITTED");

  // もう一度開いても追加はかからない → 承認
  await admin.goto(`http://localhost:3000/company/payroll?month=${month}`);
  await admin.getByTestId("received-staff-invoices").getByRole("button", { name: /委託太郎/ }).click();
  await admin.getByTestId("received-staff-invoice").waitFor();
  log("再提出された請求書は追加なしで開ける", psql(`select "teeBalance" from "Company" where id='${companyId}';`) === "4");
  admin.once("dialog", (d) => d.accept());
  await admin.getByRole("button", { name: "承認する" }).click();
  await admin.getByText("承認しました").waitFor();
  log("承認すると承認済みになる", psql(`select status from "StaffInvoice" where id='${invoiceId}';`) === "APPROVED");
  log("スタッフに承認のお知らせが届く", psql(`select count(*) from "StaffNotice" where "staffUserId"='${staffId}' and message like '%請求書が承認されました%';`) === "1");
  await admin.goto(`http://localhost:3000/company/payroll?month=${month}&staff=${staffId}`);
  log("給料明細の画面に「請求書を受け取り、承認済み」と出る", (await admin.locator("main").innerText()).includes("請求書を受け取り、承認済みです"));
  const staffPdf = await staff.request.get(`http://localhost:3000/api/staff-invoices/${invoiceId}/pdf`);
  log("スタッフ本人もPDFを見られる", staffPdf.status() === 200);

  // --- 支払明細を発行済みのスタッフの請求書は無料で開ける ---
  const staff2 = psql(
    `with ins as (insert into "User" (id, email, name, "updatedAt") values (gen_random_uuid()::text, 'sinv-staff2-${suffix}@example.com', '委託次郎', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staff2}', '${companyId}', 'STAFF');`);
  const slip = psql(`insert into "SalarySlip" (id, "companyId", "staffUserId", "targetMonth", status, "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staff2}', '${month}', 'ISSUED', now()) returning id;`);
  psql(`insert into "SalarySlipIssue" (id, "salarySlipId", snapshot, "chargedTee", "issuedAt") values (gen_random_uuid()::text, '${slip}', '{}'::jsonb, true, now());`);
  psql(`insert into "StaffInvoice" (id, "companyId", "staffUserId", "targetMonth", status, "issuerName", total, "submittedAt", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staff2}', '${month}', 'SUBMITTED', '委託次郎', 1000, now(), now());`);
  await admin.goto(`http://localhost:3000/company/payroll?month=${month}`);
  let confirm2 = "";
  admin.once("dialog", (d) => {
    confirm2 = d.message();
    d.accept();
  });
  await admin.getByTestId("received-staff-invoices").getByRole("button", { name: /委託次郎/ }).click();
  await admin.getByTestId("received-staff-invoice").waitFor();
  log("支払明細を発行済みなら「無料で開けます」と出る", confirm2.includes("無料で開けます"));
  log("支払明細を発行済みなら、開いてもTeeは減らない", psql(`select "teeBalance" from "Company" where id='${companyId}';`) === "4");

  // --- 他の会社の人はPDFを見られない ---
  await registerCompany(other, `別会社${suffix}`, `sinv-other-${suffix}@example.com`);
  const otherPdf = await other.request.get(`http://localhost:3000/api/staff-invoices/${invoiceId}/pdf`);
  log("他の会社の人はPDFを見られない", otherPdf.status() === 403);

  // --- 今の契約が業務委託でなくなったら（新しいアルバイトの契約に同意済み）、請求書は出せない ---
  const ptTpl = psql(
    `insert into "ContractTemplate" (id, "companyId", title, "employmentType", "workplaceType", "jobDescription", "scheduleType", "wageType", "wageAmount", "contractPeriodType", "contractStartDate", status, "updatedAt") values (gen_random_uuid()::text, '${companyId}', 'アルバイト契約', 'PART_TIME', 'INHOUSE', 'キャディ', 'SHIFT', 'HOURLY', 1100, 'INDEFINITE', '2026-11-01', 'LOCKED', now()) returning id;`,
  );
  psql(
    `insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", "contractStartDate", status, "consentedAt", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${ptTpl}', '${staffId}', 1100, '2026-11-01', 'ACTIVE', now(), now() + interval '1 minute', now());`,
  );
  await staff.goto("http://localhost:3000/staff/contracts");
  log("今の契約がアルバイトなら、昔の業務委託の契約が残っていても「請求書」は出ない", (await staff.locator('a[href="/staff/invoices"]').count()) === 0);
  await staff.goto(`http://localhost:3000/staff/invoices?month=${month}`);
  log("請求書の画面を直接開いても作れない", (await staff.locator("main").innerText()).includes("業務委託の契約がある会社にだけ出せます"));

  console.log(process.exitCode ? "STAFF INVOICES SMOKE TEST HAD FAILURES" : "STAFF INVOICES SMOKE TEST PASSED");
} catch (e) {
  console.error(e);
  await staff.screenshot({ path: "/tmp/sinv-staff-fail.png" }).catch(() => {});
  await admin.screenshot({ path: "/tmp/sinv-admin-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
