import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

// 請求書の明細行を手動で直しても、ページを開き直すたび（getOrCreateInvoice
// →regenerateLinesが毎回シフト由来の行を全削除して作り直していたため）に
// 自動計算値へ戻ってしまっていたバグを検証する。編集も削除も、ページを
// 開き直した後まで残ることを確認する（payroll.tsの同じ修正パターン参照）。

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

const suffix = Date.now();
const adminEmail = `invedit-admin-${suffix}@example.com`;
const staffEmail = `invedit-staff-${suffix}@example.com`;
const companyName = `請求編集確認株式会社${suffix}`;
const today = new Date().toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "請求編集確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  psql(`update "Company" set "invoiceRegistrationNumber" = 'T1234567890123' where id = '${companyId}';`);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "請求編集確認先");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);
  const companyRelationshipId = psql(
    `select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' order by "createdAt" desc limit 1;`,
  );

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=請求編集確認先");
  await admin.waitForTimeout(300);
  const clientPanel = admin.locator("div.fixed.inset-0.z-30").last();
  await clientPanel.getByRole("button", { name: "単価", exact: true }).click();
  await clientPanel.getByRole("button", { name: "＋業務内容を追加" }).click();
  await clientPanel.locator('input[placeholder*="業務内容"]').fill("接客");
  await clientPanel.locator('input[placeholder="金額"]').fill("1500");
  await clientPanel.getByRole("button", { name: "追加", exact: true }).click();
  await admin.waitForTimeout(500);
  await clientPanel.click("text=閉じる");
  await admin.waitForTimeout(200);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "請求編集確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  const assignModal1 = admin.locator("div.fixed.inset-0.z-20").last();
  await assignModal1.getByRole("button", { name: "請求編集確認先" }).click();
  await assignModal1.getByRole("button", { name: /接客/ }).click();
  await assignModal1.getByRole("button", { name: "請求編集確認スタッフ" }).click();
  await assignModal1.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal1.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  const shiftId = psql(`select id from "Shift" where "staffUserId"='${staffUserId}' order by "createdAt" desc limit 1;`);

  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.getByRole("button", { name: "勤務開始" }).click();
  await staff.waitForTimeout(400);
  psql(`update "WorkReport" set "clockIn" = now() - interval '6 hours' where "shiftId"='${shiftId}';`);
  await staff.getByRole("button", { name: "勤務終了" }).click();
  await staff.waitForTimeout(400);
  await staff.getByRole("button", { name: "業務報告を提出する" }).click();
  await staff.waitForTimeout(600);

  await admin.goto("http://localhost:3000/company/settings?tab=workreports");
  await admin.getByRole("button", { name: "承認する" }).click();
  await admin.waitForTimeout(600);

  // --- ①明細行の数量を手直しして、ページを開き直しても残るか ---
  const invoiceUrl = `http://localhost:3000/company/invoices?month=${thisMonth}&client=${companyRelationshipId}`;
  await admin.goto(invoiceUrl);
  await admin.waitForTimeout(400);
  const hoursInputBefore = await admin.locator("table input[type=number]").first().inputValue();
  log("編集前は自動計算どおり6時間になっている", hoursInputBefore === "6");

  await admin.locator("table input[type=number]").first().fill("5");
  await admin.locator("table input[type=number]").first().blur();
  await admin.waitForTimeout(500);

  const invoiceId = psql(`select id from "Invoice" where "companyRelationshipId"='${companyRelationshipId}';`);
  const lineAfterEdit = psql(
    `select hours, "isManuallyEdited" from "InvoiceLine" where "invoiceId"='${invoiceId}' and "shiftId"='${shiftId}';`,
  );
  log("編集直後、DB上のhoursが5に変わりisManuallyEditedが立つ", lineAfterEdit === "5|t");

  // ページを開き直す（regenerateLinesが再度走る）
  await admin.goto(invoiceUrl);
  await admin.waitForTimeout(400);
  const hoursInputAfterReload = await admin.locator("table input[type=number]").first().inputValue();
  log("ページを開き直しても手直しした5時間のまま（自動計算の6時間に戻らない）", hoursInputAfterReload === "5");

  // --- ②明細行を削除して、ページを開き直しても消えたままか ---
  await admin.locator("table").getByRole("button", { name: "✕", exact: true }).first().click();
  await admin.waitForTimeout(500);
  let body = await admin.locator("body").innerText();
  log("削除直後は明細から消える", !body.includes("請求編集確認スタッフ"));

  const excludedShiftIds = psql(`select "excludedShiftIds"::text from "Invoice" where id='${invoiceId}';`);
  log("削除したshiftIdがexcludedShiftIdsに記録される", excludedShiftIds.includes(shiftId));

  await admin.goto(invoiceUrl);
  await admin.waitForTimeout(400);
  body = await admin.locator("body").innerText();
  log("ページを開き直しても削除した行は復活しない", !body.includes("請求編集確認スタッフ"));

  console.log(process.exitCode ? "INVOICE LINE EDIT PERSISTENCE SMOKE TEST HAD FAILURES" : "INVOICE LINE EDIT PERSISTENCE SMOKE TEST PASSED");
} catch (err) {
  console.error("INVOICE LINE EDIT PERSISTENCE SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
