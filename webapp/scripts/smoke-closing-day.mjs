import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 締め日（月末締め以外）：
// ・依頼主ごとに請求書の締め日を選べる（依頼主の詳細の「編集」）。20日締めなら「◯月分」は前の月の21日〜その月の20日の勤務
// ・請求書の画面・PDFに対象期間が出る
// ・会社の設定で給料の締め日を選べ、給料明細の画面に対象期間が出る

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
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
async function pdfText(page, url) {
  const res = await page.request.get(url);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await res.body()) }).promise;
  const content = await (await doc.getPage(1)).getTextContent();
  return content.items.map((it) => it.str).join("");
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext()).newPage();
const suffix = Date.now();
const companyName = `締め日確認株式会社${suffix}`;
const clientName = `締め日ゴルフ場${suffix}`;

// 2か月前の月を「◯月分」にする（勤務日がすべて過去になるように）
const now = new Date(Date.now() + 9 * 3600e3);
const ym = (d) => d.toISOString().slice(0, 7);
const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
const before = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
const month = ym(target);
const tM = target.getUTCMonth() + 1;
const bM = before.getUTCMonth() + 1;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "締め日管理者");
  await page.fill("#email", `closing-admin-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  psql(`update "Company" set "agencyEnabled"=true where id='${companyId}';`);
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") values (gen_random_uuid()::text, '${companyId}', '${companyId}', '${clientName}', 'ACTIVE', now()) returning id) select id from ins;`,
  );
  const rateId = psql(
    `with ins as (insert into "CompanyPlacementRate" (id, "companyId", "companyRelationshipId", "taskName", "createdAt") values (gen_random_uuid()::text, '${companyId}', '${relId}', 'キャディ', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyPlacementRateVersion" (id, "placementRateId", "wageType", amount, "effectiveFrom", "createdAt") values (gen_random_uuid()::text, '${rateId}', 'HOURLY', 1500, '2020-01-01', now());`);
  const staffId = psql(
    `with ins as (insert into "User" (id, email, name, "createdAt", "updatedAt") values (gen_random_uuid()::text, 'closing-staff-${suffix}@example.com', '締め日スタッフ', now(), now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);
  // 前の月の20日・21日、その月の20日・21日に勤務（20日締めなら、入るのは前の月の21日とその月の20日）
  const dates = [`${ym(before)}-20`, `${ym(before)}-21`, `${month}-20`, `${month}-21`];
  for (const d of dates) {
    const shiftId = psql(
      `with ins as (insert into "Shift" (id, "companyId", "staffUserId", "companyRelationshipId", source, date, "startTime", "endTime", "taskName", "createdVia", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', '${relId}', 'CLIENT', '${d}', '08:00', '12:00', 'キャディ', 'ASSIGN', now()) returning id) select id from ins;`,
    );
    psql(
      `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "computedMinutes", "approvalStatus", "submittedAt", "clockIn", "clockOut", "updatedAt") values (gen_random_uuid()::text, '${shiftId}', '${staffId}', 'WORKED', 240, 'APPROVED', now(), '${d} 00:00:00', '${d} 04:00:00', now());`,
    );
  }

  // --- 依頼主の詳細で請求書の締め日を20日にする ---
  await page.goto("http://localhost:3000/company/roster");
  await page.click("text=依頼主一覧");
  await page.waitForTimeout(300);
  await page.click(`text=${clientName}`);
  const panel = page.locator("div.fixed.inset-0.z-30").last();
  await panel.getByRole("button", { name: "チームとの紐付けを編集" }).click();
  await panel.getByLabel("請求書の締め日").selectOption("20");
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(800);
  log("依頼主ごとに請求書の締め日を保存できる", psql(`select "invoiceClosingDay" from "CompanyRelationship" where id='${relId}';`) === "20");
  log("依頼主の詳細に「請求書：20日締め」と出る", (await panel.innerText()).includes("請求書：20日締め"));

  // --- 請求書：前の月の21日〜その月の20日の勤務だけが入る ---
  await page.goto(`http://localhost:3000/company/invoices?month=${month}&client=${relId}`);
  await page.waitForTimeout(1500);
  const invoiceId = psql(`select id from "Invoice" where "companyRelationshipId"='${relId}';`);
  const lineDates = psql(
    `select string_agg(to_char(s.date,'YYYY-MM-DD'), ',' order by s.date) from "InvoiceLine" l join "Shift" s on s.id=l."shiftId" where l."invoiceId"='${invoiceId}';`,
  );
  log("20日締めの請求書には、前の月の21日〜その月の20日の勤務だけが入る", lineDates === `${ym(before)}-21,${month}-20`);
  const banner = await page.getByTestId("invoice-period-range").innerText();
  log("請求書の画面に対象期間が出る", banner.includes(`対象期間：${bM}/21〜${tM}/20`) && banner.includes("20日締め"));
  const pdf = await pdfText(page, `http://localhost:3000/api/invoices/${invoiceId}/pdf`);
  log("請求書のPDFに対象期間が出る", pdf.includes(`対象期間：${bM}/21〜${tM}/20`));

  // --- 会社の設定で給料の締め日を15日にする ---
  await page.goto("http://localhost:3000/company/settings");
  await page.locator("section, div", { hasText: "会社情報" }).getByRole("button", { name: /変更/ }).first().click();
  await page.getByLabel("給料の締め日").selectOption("15");
  await page.getByRole("button", { name: "保存", exact: true }).first().click();
  await page.waitForTimeout(800);
  log("会社の給料の締め日を保存できる", psql(`select "payrollClosingDay" from "Company" where id='${companyId}';`) === "15");
  log("会社情報に「15日締め」と出る", (await page.locator("main").innerText()).includes("15日締め"));

  await page.goto(`http://localhost:3000/company/payroll?month=${month}&staff=${staffId}`);
  await page.waitForTimeout(1500);
  const payrollBanner = await page.getByTestId("payroll-period-range").innerText().catch(() => "");
  log("給料明細の画面に対象期間が出る（15日締め）", payrollBanner.includes(`対象期間：${bM}/16〜${tM}/15`));

  // 末日締めに戻すと、対象期間の表示は消える
  psql(`update "CompanyRelationship" set "invoiceClosingDay"=null where id='${relId}';`);
  await page.goto(`http://localhost:3000/company/invoices?month=${month}&client=${relId}`);
  await page.waitForTimeout(1200);
  log("末日締めなら対象期間の表示は出ない", (await page.getByTestId("invoice-period-range").count()) === 0);
  const monthEndDates = psql(
    `select string_agg(to_char(s.date,'YYYY-MM-DD'), ',' order by s.date) from "InvoiceLine" l join "Shift" s on s.id=l."shiftId" where l."invoiceId"='${invoiceId}';`,
  );
  log("末日締めに戻すと、その月の1日〜末日の勤務になる", monthEndDates === `${month}-20,${month}-21`);

  console.log(process.exitCode ? "CLOSING DAY SMOKE TEST HAD FAILURES" : "CLOSING DAY SMOKE TEST PASSED");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "/tmp/closing-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
