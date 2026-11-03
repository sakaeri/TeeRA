import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 請求書PDFの明細を業務ごとにまとめ、実績表を2ページ目以降に付ける：
// ・「業務ごとにまとめる」（最初から）：業務×単価ごとに1行、時間を合計、時給は件数を添える
// ・手で追加した行（交通費など）は1行ずつのまま
// ・実績表には請求書に載ったシフトだけが出る（明細から外したシフトは出ない）
// ・「1件ずつ」に切り替えるとシフト1件ずつ、「実績表を付ける」を外すと1ページだけ
// ・発行すると、その時の載せ方と実績表がスナップショットに固定される

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
async function pdfPages(page, url) {
  const res = await page.request.get(url);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await res.body()) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => it.str).join(""));
  }
  return pages;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext()).newPage();
const suffix = Date.now();
const companyName = `明細まとめ確認株式会社${suffix}`;

// 先月（今月だと日付によって勤務日が未来になるため）
const now = new Date(Date.now() + 9 * 3600e3);
const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const month = prev.toISOString().slice(0, 7);
const day = (d) => `${month}-${String(d).padStart(2, "0")}`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "明細まとめ管理者");
  await page.fill("#email", `group-admin-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  psql(
    `update "Company" set "agencyEnabled" = true, "teeBalance" = 10, "invoiceRegistrationNumber" = 'T1234567890123' where id = '${companyId}';` +
      `insert into "TeeLedgerEntry" (id, "companyId", type, amount, "balanceAfter", "createdAt") values (gen_random_uuid()::text, '${companyId}', 'ADJUSTMENT', 10, 10, now());`,
  );
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") values (gen_random_uuid()::text, '${companyId}', '${companyId}', '明細まとめゴルフ場', 'ACTIVE', now()) returning id) select id from ins;`,
  );
  // 単価：キャディ＝時給1,500円、清掃＝日給8,000円
  for (const [task, wageType, amount] of [
    ["キャディ", "HOURLY", 1500],
    ["清掃", "DAILY", 8000],
  ]) {
    const rateId = psql(
      `with ins as (insert into "CompanyPlacementRate" (id, "companyId", "companyRelationshipId", "taskName", "createdAt") values (gen_random_uuid()::text, '${companyId}', '${relId}', '${task}', now()) returning id) select id from ins;`,
    );
    psql(
      `insert into "CompanyPlacementRateVersion" (id, "placementRateId", "wageType", amount, "effectiveFrom", "createdAt") values (gen_random_uuid()::text, '${rateId}', '${wageType}', ${amount}, '2020-01-01', now());`,
    );
  }

  const staffA = psql(
    `with ins as (insert into "User" (id, email, name, "createdAt", "updatedAt") values (gen_random_uuid()::text, 'group-a-${suffix}@example.com', '明細スタッフ甲', now(), now()) returning id) select id from ins;`,
  );
  const staffB = psql(
    `with ins as (insert into "User" (id, email, name, "createdAt", "updatedAt") values (gen_random_uuid()::text, 'group-b-${suffix}@example.com', '明細スタッフ乙', now(), now()) returning id) select id from ins;`,
  );
  const shifts = {};
  // [名前, スタッフ, 日, 業務, 勤務分]
  for (const [key, staffId, d, task, minutes] of [
    ["a1", staffA, 5, "キャディ", 360],
    ["a2", staffA, 6, "キャディ", 270],
    ["b1", staffB, 7, "キャディ", 300],
    ["b2", staffB, 8, "清掃", 480],
    ["b3", staffB, 9, "キャディ", 120],
  ]) {
    const id = psql(
      `with ins as (insert into "Shift" (id, "companyId", "staffUserId", "companyRelationshipId", source, date, "startTime", "endTime", "taskName", "createdVia", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', '${relId}', 'CLIENT', '${day(d)}', '08:00', '17:00', '${task}', 'ASSIGN', now()) returning id) select id from ins;`,
    );
    psql(
      `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "computedMinutes", "approvalStatus", "submittedAt", "clockIn", "clockOut", "updatedAt") values (gen_random_uuid()::text, '${id}', '${staffId}', 'WORKED', ${minutes}, 'APPROVED', now(), '${day(d)} 00:00:00', '${day(d)} 00:00:00'::timestamp + interval '${minutes} minutes', now());`,
    );
    shifts[key] = id;
  }

  const invoiceUrl = `http://localhost:3000/company/invoices?month=${month}&client=${relId}`;
  await page.goto(invoiceUrl);
  await page.waitForTimeout(1200);
  const invoiceId = psql(`select id from "Invoice" where "companyRelationshipId"='${relId}';`);
  log("明細はシフト5件分できる", psql(`select count(*) from "InvoiceLine" where "invoiceId"='${invoiceId}' and "shiftId" is not null;`) === "5");
  log("最初は「業務ごとにまとめる」が選ばれている", (await page.getByRole("radio", { name: "業務ごとにまとめる" }).getAttribute("aria-checked")) === "true");
  log("最初は「実績表を付ける」にチェックが入っている", await page.getByRole("checkbox", { name: /実績表を付ける/ }).isChecked());

  // 1件（乙の9日）を明細から外し、交通費を手で足す
  psql(
    `insert into "InvoiceLine" (id, "invoiceId", "staffName", description, hours, rate, amount, "taxRatePercent", "sortOrder") values (gen_random_uuid()::text, '${invoiceId}', '', '交通費', 3, 500, 1500, 10, 99);`,
  );
  await page.locator("tr", { hasText: `${day(9)} 勤務` }).getByRole("button", { name: "✕", exact: true }).click();
  await page.waitForTimeout(800);

  const pdfUrl = `http://localhost:3000/api/invoices/${invoiceId}/pdf`;
  let pages = await pdfPages(page, pdfUrl);
  const first = pages[0] ?? "";
  // キャディ：6h + 4.5h + 5h = 15.5h × 1,500円 = 23,250円（3件）
  log("キャディは1行にまとまり、時間の合計と件数が出る", first.includes("キャディ（3件）") && first.includes("15.5") && first.includes("23,250円"));
  log("清掃（日給）は件数を添えず1行", first.includes("清掃") && !first.includes("清掃（") && first.includes("8,000円"));
  log("手で足した交通費はそのまま1行（業務の行の後）", first.includes("交通費") && first.includes("1,500円") && first.indexOf("交通費") > first.indexOf("清掃"));
  log("まとめた明細にはスタッフ名や日付は出ない", !first.includes("明細スタッフ甲") && !first.includes(day(5)));
  log("PDFは2ページ以上（2ページ目以降が実績表）", pages.length >= 2);
  log("見本のPDFは請求書・実績表とも「ーTeeRA見本ー」の透かし入り", first.includes("TeeRA見本") && (pages[1] ?? "").includes("TeeRA見本"));
  const record = pages.slice(1).join("");
  log("実績表に請求書のシフトのスタッフと報告の時間が出る", record.includes("実績表") && record.includes("明細スタッフ甲") && record.includes("09:00〜13:30"));
  log("明細から外したシフト（9日）は実績表に出ない", !record.includes("9日（"));

  // --- 1件ずつ ---
  await page.getByRole("radio", { name: "1件ずつ" }).click();
  await page.waitForTimeout(800);
  log("「1件ずつ」が保存される", psql(`select "groupLinesByTask" from "Invoice" where id='${invoiceId}';`) === "f");
  pages = await pdfPages(page, pdfUrl);
  log("1件ずつのときはスタッフ名と日付の行が出る", pages[0].includes("明細スタッフ甲") && pages[0].includes(`${day(5)} 勤務（キャディ）`));

  // --- 実績表を外す ---
  await page.getByRole("checkbox", { name: /実績表を付ける/ }).uncheck();
  await page.waitForTimeout(800);
  log("「実績表を付ける」を外すと保存される", psql(`select "attachWorkRecord" from "Invoice" where id='${invoiceId}';`) === "f");
  pages = await pdfPages(page, pdfUrl);
  log("実績表を外すと請求書だけ（1ページ）", pages.length === 1 && !pages[0].includes("実績表"));

  // --- 戻して発行 ---
  await page.getByRole("radio", { name: "業務ごとにまとめる" }).click();
  await page.waitForTimeout(600);
  await page.getByRole("checkbox", { name: /実績表を付ける/ }).check();
  await page.waitForTimeout(600);
  psql(`update "Invoice" set "dueDate" = '${day(28)}' where id='${invoiceId}';`);
  await page.goto(invoiceUrl);
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "PDFで請求書を発行する", exact: true }).click();
  const confirm = page.getByRole("button", { name: "発行する", exact: true });
  if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click();
  await page.waitForTimeout(1200);
  const issueId = psql(`select id from "InvoiceIssue" where "invoiceId"='${invoiceId}' order by "issuedAt" desc limit 1;`);
  log("発行できる", Boolean(issueId));
  const snap = psql(`select snapshot->>'groupLinesByTask', jsonb_array_length(snapshot->'workRecord'->'rows') from "InvoiceIssue" where id='${issueId}';`);
  log("発行時の載せ方と実績表（4件）がスナップショットに入る", snap === "true|4");

  // 発行後に報告の時間が変わっても、発行済みの実績表は変わらない
  psql(`update "WorkReport" set "clockOut" = "clockIn" + interval '1 minute' where "shiftId"='${shifts.a1}';`);
  pages = await pdfPages(page, `${pdfUrl}?issueId=${issueId}`);
  log("発行済みPDFもまとめた明細＋実績表", pages[0].includes("キャディ（3件）") && pages.length >= 2);
  log("発行済みのPDFには見本の透かしが入らない", !pages.join("").includes("TeeRA見本"));
  log("発行済みの実績表は発行時点の時間のまま", pages.slice(1).join("").includes("09:00〜15:00"));

  // 一括ダウンロードにも実績表が付く
  pages = await pdfPages(page, `http://localhost:3000/api/invoices/bulk-pdf?month=${month}`);
  log("一括PDFにも実績表が付く", pages.length >= 2 && pages.slice(1).join("").includes("実績表"));

  // 以前に発行したもの（載せ方の記録なし）は1件ずつ・実績表なしのまま
  const oldSnap = JSON.stringify({
    periodLabel: month,
    note: null,
    lines: [{ shiftId: shifts.a1, staffName: "明細スタッフ甲", description: `${day(5)} 勤務（キャディ）`, hours: 6, rate: 1500, amount: 9000, taxRatePercent: 10 }],
    registered: true,
    invoiceRegistrationNumber: "T1234567890123",
    brackets: [{ rate: 10, subtotal: 9000, tax: 900 }],
    subtotalAll: 9000,
    taxAll: 900,
    total: 9900,
    issuedAt: new Date().toISOString(),
  }).replace(/'/g, "''");
  const oldIssue = psql(
    `with ins as (insert into "InvoiceIssue" (id, "invoiceId", snapshot, "issuedAt") values (gen_random_uuid()::text, '${invoiceId}', '${oldSnap}'::jsonb, now() - interval '1 day') returning id) select id from ins;`,
  );
  pages = await pdfPages(page, `${pdfUrl}?issueId=${oldIssue}`);
  log("以前に発行したものは発行した時のまま（1件ずつ・1ページ）", pages.length === 1 && pages[0].includes("明細スタッフ甲"));

  console.log(process.exitCode ? "INVOICE GROUPING SMOKE TEST HAD FAILURES" : "INVOICE GROUPING SMOKE TEST PASSED");
} catch (err) {
  console.error("INVOICE GROUPING SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
