import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 依頼主への請求書：前の月に請求していなかったシフトは、勝手には入れず
// 「前の月以前に請求していない分が◯件あります」→「この請求書に入れる」で入れる。
// 入れたシフトは、前の月の請求書からは外れる（二重に載らない）。

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
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const suffix = Date.now();
const companyName = `前月未請求確認株式会社${suffix}`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "未請求本部");
  await page.fill("#email", `unbilled-${suffix}@example.com`);
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
    `insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") values (gen_random_uuid()::text, '${companyId}', '${companyId}', '未請求ゴルフ倶楽部', 'ACTIVE', now()) returning id;`,
  );
  const rateId = psql(`insert into "CompanyPlacementRate" (id, "companyId", "companyRelationshipId", "taskName") values (gen_random_uuid()::text, '${companyId}', '${relId}', 'キャディ') returning id;`);
  psql(`insert into "CompanyPlacementRateVersion" (id, "placementRateId", "wageType", amount, "effectiveFrom") values (gen_random_uuid()::text, '${rateId}', 'DAILY', 15000, '2025-01-01');`);
  const staffId = psql(
    `insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'unbilled-staff-${suffix}@example.com', 'x', '未請求スタッフ', now()) returning id;`,
  );
  psql(`insert into "CompanyMembership" (id, "companyId", "userId", role) values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'STAFF');`);

  const today = psql(`select (now() at time zone 'Asia/Tokyo')::date::text;`);
  const thisMonth = today.slice(0, 7);
  const [y, m] = thisMonth.split("-").map(Number);
  const lastMonthDate = new Date(Date.UTC(y, m - 2, 25)).toISOString().slice(0, 10);
  const lastMonth = lastMonthDate.slice(0, 7);
  const addShift = (date) => {
    const id = psql(
      `insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'CLIENT', '${relId}', 'キャディ', '${date}', '08:00', '17:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id;`,
    );
    psql(
      `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "computedMinutes", "submittedAt", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${id}', '${staffId}', 'WORKED', 'APPROVED', 480, now(), now(), now());`,
    );
    return id;
  };
  const earlierShift = addShift(lastMonthDate);
  addShift(`${thisMonth}-01`);

  // 今月の請求書：前の月の分は勝手には入らず、案内が出る
  await page.goto(`http://localhost:3000/company/invoices?month=${thisMonth}&client=${relId}`);
  const banner = page.getByTestId("unbilled-earlier");
  await banner.waitFor({ timeout: 30000 });
  const lineCount = () => psql(`select count(*) from "InvoiceLine" l join "Invoice" i on i.id=l."invoiceId" where i."companyRelationshipId"='${relId}' and i."periodLabel"='${thisMonth}' and l."shiftId" is not null;`);
  log("前の月に請求していない分の案内が出る（勝手には入らない）", (await banner.innerText()).includes("1件") && lineCount() === "1");
  log("案内には日付を出さない（確認するで見られる）", !(await banner.innerText()).includes(`${Number(lastMonthDate.slice(5, 7))}/${Number(lastMonthDate.slice(8, 10))}`));
  // 「確認する」で一覧（全部✅）が出て、✅のものだけ入れる
  await banner.getByRole("button", { name: "確認する" }).click();
  log("「確認する」で一覧が出て、最初から✅が付いている", (await banner.getByTestId("unbilled-earlier-check").first().isChecked()));
  // 行（名前のあたり）を押しても✅が付け外しできる
  await banner.getByTestId("unbilled-earlier-row").first().click({ position: { x: 150, y: 10 } });
  log("行を押すと✅が外れる", !(await banner.getByTestId("unbilled-earlier-check").first().isChecked()));
  await banner.getByTestId("unbilled-earlier-row").first().click({ position: { x: 150, y: 10 } });
  log("もう一度押すと✅が付く", await banner.getByTestId("unbilled-earlier-check").first().isChecked());
  await banner.getByRole("button", { name: /件をこの請求書に入れる/ }).click();
  await banner.waitFor({ state: "detached", timeout: 15000 });
  log("✅のものが明細に入る", lineCount() === "2" && (await page.locator("body").innerText()).includes(lastMonthDate));

  // 入れた行を×で消すと、未請求に戻ってまた案内に出る
  page.on("dialog", (d) => d.accept());
  const earlierLineId = psql(`select l.id from "InvoiceLine" l join "Invoice" i on i.id=l."invoiceId" where i."companyRelationshipId"='${relId}' and i."periodLabel"='${thisMonth}' and l."shiftId"='${earlierShift}';`);
  const delBtn = page.locator(`[data-line-id="${earlierLineId}"] button[aria-label*="削除"], [data-line-id="${earlierLineId}"] button:has-text("×")`).first();
  if ((await delBtn.count()) > 0) {
    await delBtn.click();
  } else {
    // 行の削除ボタンが見つからない時は、行の中の最後のボタン（×）を押す
    await page.locator("tr, li", { hasText: lastMonthDate }).last().getByRole("button").last().click();
  }
  await page.getByTestId("unbilled-earlier").waitFor({ timeout: 15000 });
  log("入れた行を×で消すと未請求に戻り、また案内に出る", lineCount() === "1" && (await page.getByTestId("unbilled-earlier").innerText()).includes("1件"));
  // 入れ直してから、前の月の請求書を確かめる
  await page.getByTestId("unbilled-earlier").getByRole("button", { name: "確認する" }).click();
  await page.getByTestId("unbilled-earlier").getByRole("button", { name: /件をこの請求書に入れる/ }).click();
  await page.getByTestId("unbilled-earlier").waitFor({ state: "detached", timeout: 15000 });
  log("もう一度入れられる", lineCount() === "2");

  // 前の月の請求書を開いても、今月に入れたシフトは載らない（二重にならない）
  await page.goto(`http://localhost:3000/company/invoices?month=${lastMonth}&client=${relId}`);
  await page.waitForTimeout(1500);
  const lastMonthLines = psql(`select count(*) from "InvoiceLine" l join "Invoice" i on i.id=l."invoiceId" where i."companyRelationshipId"='${relId}' and i."periodLabel"='${lastMonth}' and l."shiftId"='${earlierShift}';`);
  log("前の月の請求書には、今月に入れたシフトは載らない", lastMonthLines === "0");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(process.exitCode ? "INVOICE UNBILLED EARLIER SMOKE TEST FAILED" : "INVOICE UNBILLED EARLIER SMOKE TEST PASSED");
