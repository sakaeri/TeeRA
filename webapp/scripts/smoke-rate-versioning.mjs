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
function addDays(dateStr, delta) {
  const d = new Date(dateStr + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminEmail = `ratever-admin-${Date.now()}@example.com`;
const staffEmail = `ratever-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "履歴検証管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "履歴検証株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='履歴検証株式会社' order by "createdAt" desc limit 1;`);
  psql(`update "Company" set "teeBalance" = 10 where id = '${companyId}';` +
    `insert into "TeeLedgerEntry" (id, "companyId", type, amount, "balanceAfter", "createdAt") values (gen_random_uuid()::text, '${companyId}', 'ADJUSTMENT', 10, 10, now());`);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加する");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "履歴先");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);
  const relId = psql(`select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' order by "createdAt" desc limit 1;`);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "履歴スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  const today = psql(`select to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM-DD');`);
  const oldShiftDate = addDays(today, -10); // before the rate change
  const newShiftDate = addDays(today, 1); // after the rate change (tomorrow, avoids conflicting with today's default)

  // register the task + an initial rate of 1000円/h via 依頼主詳細＞単価タブ,
  // effective from 30 days ago (covers oldShiftDate)
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=履歴先");
  await admin.waitForTimeout(300);
  let panel = admin.locator("div.fixed.inset-0.z-30").last();
  await panel.getByRole("button", { name: "単価", exact: true }).click();
  await panel.getByRole("button", { name: "＋業務内容を追加" }).click();
  await panel.locator('input[placeholder*="業務内容"]').fill("警備業務");
  await panel.locator('input[placeholder="金額"]').fill("1000");
  await panel.locator('input[type=date]').fill(addDays(today, -30));
  await panel.getByRole("button", { name: "追加", exact: true }).click();
  await admin.waitForTimeout(500);

  const placementRateId = psql(`select id from "CompanyPlacementRate" where "taskName"='警備業務' and "companyRelationshipId"='${relId}';`);
  log("task + first rate version registered", Boolean(placementRateId));

  // now amend it to 1500円/h, effective from TODAY — should NOT rewrite the
  // old version, just add a new one on top.
  await panel.getByRole("button", { name: "単価を変更" }).click();
  await panel.locator('input[type=number]').fill("1500");
  await panel.locator('input[type=date]').fill(today);
  await panel.getByRole("button", { name: "保存" }).click();
  await admin.waitForTimeout(500);

  const versionCount = psql(`select count(*) from "CompanyPlacementRateVersion" where "placementRateId"='${placementRateId}';`);
  log("two versions now exist (old one preserved, not overwritten)", versionCount === "2");

  await panel.getByRole("button", { name: /▼ 履歴/ }).click();
  let panelText = await panel.textContent();
  log("history tab shows both the old (1000円) and new (1500円) versions", panelText.includes("時給1000円") && panelText.includes("時給1500円"));
  await panel.click("text=閉じる");
  await admin.waitForTimeout(200);

  // shift #1: dated 10 days ago -> should bill at the OLD rate (1000円), not
  // today's rate, proving the invoice uses the rate effective on the shift's
  // own date rather than "whatever is current now".
  const oldShiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'CLIENT', '${relId}', '警備業務', '${oldShiftDate}', '09:00', '13:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt")` +
      ` values (gen_random_uuid()::text, '${oldShiftId}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '4 hours', now(), 240, now(), now());`,
  );

  const oldMonth = oldShiftDate.slice(0, 7);
  await admin.goto(`http://localhost:3000/company/invoices?month=${oldMonth}&client=${relId}`);
  await admin.waitForTimeout(500);
  const oldLine = JSON.parse(
    psql(`select json_agg(json_build_object('rate',rate,'amount',amount))->0 from "InvoiceLine" il join "Invoice" i on i.id=il."invoiceId" where i."companyRelationshipId"='${relId}' and il."shiftId"='${oldShiftId}';`),
  );
  log("a shift dated BEFORE the rate change bills at the OLD rate (1000円/h), not today's 1500円", oldLine && Number(oldLine.rate) === 1000 && Number(oldLine.amount) === 4000);

  // shift #2: dated tomorrow -> should bill at the NEW rate (1500円)
  const newShiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'CLIENT', '${relId}', '警備業務', '${newShiftDate}', '09:00', '13:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt")` +
      ` values (gen_random_uuid()::text, '${newShiftId}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '4 hours', now(), 240, now(), now());`,
  );
  const newMonth = newShiftDate.slice(0, 7);
  await admin.goto(`http://localhost:3000/company/invoices?month=${newMonth}&client=${relId}`);
  await admin.waitForTimeout(500);
  const newLine = JSON.parse(
    psql(`select json_agg(json_build_object('rate',rate,'amount',amount))->0 from "InvoiceLine" il join "Invoice" i on i.id=il."invoiceId" where i."companyRelationshipId"='${relId}' and il."shiftId"='${newShiftId}';`),
  );
  log("a shift dated AFTER the rate change bills at the NEW rate (1500円/h)", newLine && Number(newLine.rate) === 1500 && Number(newLine.amount) === 6000);

  // now end the rate entirely (from tomorrow) and confirm a shift the day
  // after still resolves to "unpriced" (history preserved, not deleted).
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=履歴先");
  await admin.waitForTimeout(300);
  panel = admin.locator("div.fixed.inset-0.z-30").last();
  await panel.getByRole("button", { name: "単価", exact: true }).click();
  await panel.getByRole("button", { name: "終了する" }).click();
  const endDate = addDays(today, 2);
  await panel.locator('input[type=date]').fill(endDate);
  await panel.getByRole("button", { name: "終了する", exact: true }).last().click();
  await admin.waitForTimeout(500);

  const versionCountAfterEnd = psql(`select count(*) from "CompanyPlacementRateVersion" where "placementRateId"='${placementRateId}';`);
  log("ending the rate adds a 3rd version (history preserved, nothing deleted)", versionCountAfterEnd === "3");

  const shiftAfterEndId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'CLIENT', '${relId}', '警備業務', '${endDate}', '09:00', '13:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt")` +
      ` values (gen_random_uuid()::text, '${shiftAfterEndId}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '4 hours', now(), 240, now(), now());`,
  );
  const endMonth = endDate.slice(0, 7);
  await admin.goto(`http://localhost:3000/company/invoices?month=${endMonth}&client=${relId}`);
  await admin.waitForTimeout(500);
  const bodyAfterEnd = await admin.textContent("body");
  log("a shift dated after the ended rate shows up as 単価未設定 again", bodyAfterEnd.includes("単価未設定"));

  console.log(process.exitCode ? "RATE VERSIONING SMOKE TEST HAD FAILURES" : "RATE VERSIONING SMOKE TEST PASSED");
} catch (err) {
  console.error("RATE VERSIONING SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-rate-versioning-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
