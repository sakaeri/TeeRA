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

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminEmail = `inv-admin-${Date.now()}@example.com`;
const staffEmail = `inv-staff-${Date.now()}@example.com`;
const today = new Date().toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "請求管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "請求テスト株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  const companyId = psql(`select id from "Company" where name='請求テスト株式会社' order by "createdAt" desc limit 1;`);
  psql(
    `update "Company" set "teeBalance" = 10, "invoiceRegistrationNumber" = 'T1234567890123' where id = '${companyId}';` +
      `insert into "TeeLedgerEntry" (id, "companyId", type, amount, "balanceAfter", "createdAt") values (gen_random_uuid()::text, '${companyId}', 'ADJUSTMENT', 10, 10, now());`,
  );

  // activate agency module with a proxy client
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋ 取引先名簿を追加");
  await admin.click("text=依頼主名簿");
  await admin.fill('input[placeholder="名称を入力"]', "GREEN TABLE 渋谷店");
  await admin.click("text=作成");
  await admin.waitForTimeout(600);
  const companyRelationshipId = psql(
    `select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' order by "createdAt" desc limit 1;`,
  );
  log("proxy client relationship created", Boolean(companyRelationshipId));

  // placement rate for this client: 1500/hr
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.selectOption("select", { label: "GREEN TABLE 渋谷店" });
  await admin.fill('input[placeholder="業務内容"]', "接客");
  await admin.fill('input[placeholder="金額"]', "1500");
  await admin.getByRole("button", { name: "＋追加" }).click();
  await admin.waitForTimeout(500);

  // invite + register staff
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを招待する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "請求スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // assign a CLIENT-source shift today for this staff at the client
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  const assignModal1 = admin.locator("div.fixed.inset-0.z-20").last();
  await assignModal1.getByRole("button", { name: "GREEN TABLE 渋谷店" }).click();
  await assignModal1.getByRole("button", { name: "請求スタッフ" }).click();
  await assignModal1.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal1.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  const shiftId = psql(`select id from "Shift" where "staffUserId"='${staffUserId}' order by "createdAt" desc limit 1;`);
  const shiftSource = psql(`select source from "Shift" where id='${shiftId}';`);
  log("shift created with source=CLIENT", shiftSource === "CLIENT");

  // staff clock in/out (backdated) + submit + admin approves
  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.getByRole("button", { name: "出勤" }).click();
  await staff.waitForTimeout(400);
  psql(`update "WorkReport" set "clockIn" = now() - interval '6 hours' where "shiftId"='${shiftId}';`);
  await staff.getByRole("button", { name: "退勤" }).click();
  await staff.waitForTimeout(400);
  await staff.getByRole("button", { name: "業務報告を提出する" }).click();
  await staff.waitForTimeout(600);

  await admin.goto("http://localhost:3000/company/settings?tab=workreports");
  let body = await admin.textContent("body");
  log("agency sees pending report for proxy-client shift (approves on their behalf)", body.includes("請求スタッフ"));
  await admin.getByRole("button", { name: "承認する" }).click();
  await admin.waitForTimeout(600);

  // open invoice
  await admin.goto(`http://localhost:3000/company/invoices?month=${thisMonth}&client=${companyRelationshipId}`);
  body = await admin.textContent("body");
  const hoursInputValue = await admin.locator("table input[type=number]").first().inputValue();
  log(
    "invoice line auto-generated for the client's shift",
    body.includes("請求スタッフ") && hoursInputValue === "6",
  );

  // set due date
  await admin.fill('input[type="date"]', "2026-09-30");
  await admin.getByRole("button", { name: "保存" }).first().click();
  await admin.waitForTimeout(400);
  // the due-date save button is one of several "保存" buttons; find the date-specific one via label
  const dueDateSaveBtn = admin.locator("label:has-text('支払期限') button");
  await dueDateSaveBtn.click();
  await admin.waitForTimeout(500);

  await admin.getByRole("button", { name: "確定する（課金なし）" }).click();
  await admin.waitForTimeout(600);
  body = await admin.textContent("body");
  log("invoice confirmed", body.includes("確定済み"));

  await admin.getByRole("button", { name: "発行する（1 Tee）" }).click();
  await admin.getByRole("button", { name: "発行する", exact: true }).click();
  await admin.waitForTimeout(1000);

  const balanceAfterFirstIssue = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("balance charged 1 Tee (10 -> 9)", balanceAfterFirstIssue === 9);

  const invoicedShiftIds = psql(
    `select "invoicedShiftIds" from "Invoice" where "companyRelationshipId"='${companyRelationshipId}' order by "createdAt" desc limit 1;`,
  );
  log("invoicedShiftIds locked at issuance", invoicedShiftIds.includes(shiftId));

  // reopen for edit and re-issue -> should charge AGAIN (unlike salary slip)
  await admin.reload();
  await admin.getByRole("button", { name: "内容を修正する" }).click();
  await admin.waitForTimeout(600);
  await admin.getByRole("button", { name: "確定する（課金なし）" }).click();
  await admin.waitForTimeout(600);
  await admin.getByRole("button", { name: "発行する（1 Tee）" }).click();
  await admin.getByRole("button", { name: "発行する", exact: true }).click();
  await admin.waitForTimeout(1000);

  const balanceAfterSecondIssue = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("re-issue charges again (9 -> 8), unlike salary slip", balanceAfterSecondIssue === 8);

  // fetch PDF
  const pdfLink = await admin.locator('a[href*="/api/invoices/"]').first().getAttribute("href");
  const pdfResp = await admin.request.get(`http://localhost:3000${pdfLink}`);
  const pdfBuffer = await pdfResp.body();
  log("invoice PDF generated correctly", pdfResp.headers()["content-type"] === "application/pdf" && pdfBuffer.slice(0, 4).toString() === "%PDF");

  console.log(process.exitCode ? "INVOICING SMOKE TEST HAD FAILURES" : "INVOICING SMOKE TEST PASSED");
} catch (err) {
  console.error("INVOICING SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-invoicing-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-invoicing-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
