import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 20日締めの請求書：
// ・実績表の見出しは「対象期間: 9/21〜10/20」（前の月の21日以降は「前の月以前の分」と言わない）
// ・この期間に承認済みなのに明細に入っていない勤務を、理由つきで出す（外した・請求済みにした・請求なし）
// ・外した勤務は「明細に戻す」で戻せる

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
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => it.str).join(""));
  return pages;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext()).newPage();
const suffix = Date.now();
const companyName = `漏れ確認株式会社${suffix}`;
const now = new Date(Date.now() + 9 * 3600e3);
const label = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const [ly, lm] = label.split("-").map(Number);
const prevMonth = new Date(Date.UTC(ly, lm - 2, 1)).toISOString().slice(0, 7);
const d = (ym, day) => `${ym}-${String(day).padStart(2, "0")}`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "漏れ確認管理者");
  await page.fill("#email", `missing-admin-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  psql(`update "Company" set "agencyEnabled" = true where id = '${companyId}';`);
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "invoiceClosingDay", "createdAt") values (gen_random_uuid()::text, '${companyId}', '${companyId}', '二十日締めゴルフ場', 'ACTIVE', 20, now()) returning id) select id from ins;`,
  );
  for (const [task, amount] of [
    ["キャディ", 10000],
    ["研修", 0],
  ]) {
    const rateId = psql(
      `with ins as (insert into "CompanyPlacementRate" (id, "companyId", "companyRelationshipId", "taskName", "createdAt") values (gen_random_uuid()::text, '${companyId}', '${relId}', '${task}', now()) returning id) select id from ins;`,
    );
    psql(`insert into "CompanyPlacementRateVersion" (id, "placementRateId", "wageType", amount, "effectiveFrom", "createdAt") values (gen_random_uuid()::text, '${rateId}', 'DAILY', ${amount}, '2020-01-01', now());`);
  }
  const staffId = psql(
    `with ins as (insert into "User" (id, email, name, "createdAt", "updatedAt") values (gen_random_uuid()::text, 'missing-staff-${suffix}@example.com', '漏れ確認スタッフ', now(), now()) returning id) select id from ins;`,
  );
  const addShift = (date, task) => {
    const id = psql(
      `with ins as (insert into "Shift" (id, "companyId", "staffUserId", "companyRelationshipId", source, date, "startTime", "endTime", "taskName", "createdVia", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', '${relId}', 'CLIENT', '${date}', '08:00', '17:00', '${task}', 'ASSIGN', now()) returning id) select id from ins;`,
    );
    psql(
      `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "computedMinutes", "approvalStatus", "submittedAt", "clockIn", "clockOut", "updatedAt") values (gen_random_uuid()::text, '${id}', '${staffId}', 'WORKED', 480, 'APPROVED', now(), '${date} 08:00:00', '${date} 17:00:00', now());`,
    );
    return id;
  };
  addShift(d(prevMonth, 25), "キャディ"); // 前の月の21日以降（今回の期間）
  addShift(d(label, 5), "キャディ");
  const excludedShift = addShift(d(label, 8), "キャディ");
  const billedShift = addShift(d(label, 10), "キャディ");
  psql(`update "Shift" set "clientBilledManuallyAt"=now() where id='${billedShift}';`);
  addShift(d(label, 12), "研修");

  const url = `http://localhost:3000/company/invoices?month=${label}&client=${relId}`;
  await page.goto(url);
  await page.waitForTimeout(1500);
  const invoiceId = psql(`select id from "Invoice" where "companyRelationshipId"='${relId}';`);
  // 8日の行を明細から外した状態にする
  psql(`delete from "InvoiceLine" where "invoiceId"='${invoiceId}' and "shiftId"='${excludedShift}';`);
  psql(`update "Invoice" set "excludedShiftIds"='["${excludedShift}"]' where id='${invoiceId}';`);

  await page.goto(url);
  const missing = page.getByTestId("missing-shifts");
  await missing.waitFor({ timeout: 15000 });
  log("「この期間に承認済みで、明細に入っていない勤務（3件）」が出る", (await missing.innerText()).includes("明細に入っていない勤務（3件）"));
  await missing.getByRole("button", { name: /明細に入っていない勤務/ }).click();
  const text = await missing.innerText();
  log("理由が出る（明細から外した・請求済みにした・請求なしの業務内容）", text.includes("明細から外した") && text.includes("請求済みにした") && text.includes("請求なしの業務内容"));
  await missing.getByTestId("missing-shift-row").filter({ hasText: "明細から外した" }).getByRole("button", { name: "明細に戻す" }).click();
  await page.waitForTimeout(2000);
  await page.goto(url);
  await page.waitForTimeout(1500);
  log("「明細に戻す」で、外した勤務が明細に戻る", psql(`select count(*) from "InvoiceLine" where "invoiceId"='${invoiceId}' and "shiftId"='${excludedShift}';`) === "1");

  const pages = await pdfPages(page, `http://localhost:3000/api/invoices/${invoiceId}/pdf`);
  const record = pages.slice(1).join("");
  const [pm, plm] = [Number(prevMonth.slice(5)), lm];
  log(`実績表の見出しは「対象期間: ${pm}/21〜${plm}/20」`, record.includes(`対象期間: ${pm}/21〜${plm}/20`) && !record.includes("対象月"));
  log("前の月の21日以降の勤務があっても「前の月以前の未請求分を含む」と出ない", record.includes(`${pm}月25日`) && !record.includes("前の月以前の未請求分を含む"));

  console.log(process.exitCode ? "INVOICE MISSING SHIFTS SMOKE TEST HAD FAILURES" : "INVOICE MISSING SHIFTS SMOKE TEST PASSED");
} catch (e) {
  console.error("INVOICE MISSING SHIFTS SMOKE TEST FAILED", e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
