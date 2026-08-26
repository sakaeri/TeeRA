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

const adminEmail = `taskrate-admin-${Date.now()}@example.com`;
const staffEmail = `taskrate-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "分離検証管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "分離検証株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='分離検証株式会社' order by "createdAt" desc limit 1;`);

  // client with no rates registered yet
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加する");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "分離先");
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
  await staff.fill("#name", "分離スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // --- ① shift-creation task step: no rate inputs at all ---
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  const modal = admin.locator("div.fixed.inset-0.z-20").last();
  await modal.getByRole("button", { name: "分離先" }).click();
  await admin.waitForTimeout(200);
  let bodyText = await modal.textContent();
  log("task step reached with 0 registered task names", bodyText.includes("業務内容を選択"));

  await modal.getByRole("button", { name: /新しい業務内容を追加する/ }).click();
  const taskFormHtml = await modal.innerHTML();
  log("inline add-task form has NO wage-type select", !taskFormHtml.includes("時給</option>"));
  log("inline add-task form has NO amount number input", (await modal.locator('input[type=number]').count()) === 0);

  await modal.locator('input[placeholder*="業務内容"]').fill("キャディ業務");
  await modal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await admin.waitForTimeout(500);
  bodyText = await modal.textContent();
  log("advanced to staff step after task-name-only add", bodyText.includes("スタッフを選択"));

  const taskRow = JSON.parse(
    psql(`select json_agg(json_build_object('taskName',"taskName",'wageType',"wageType",'amount',amount))->0 from "CompanyPlacementRate" where "taskName"='キャディ業務' and "companyRelationshipId"='${relId}';`),
  );
  log("CompanyPlacementRate row created with taskName only, wageType/amount null", taskRow.taskName === "キャディ業務" && taskRow.wageType === null && taskRow.amount === null);

  await modal.getByRole("button", { name: "分離スタッフ" }).click();
  await modal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  bodyText = await modal.textContent();
  log("confirm screen shows task name only, no wage info", bodyText.includes("キャディ業務") && !bodyText.includes("時給") && !bodyText.includes("日給"));
  await modal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  const shiftId = psql(`select id from "Shift" where "staffUserId"='${staffUserId}' order by "createdAt" desc limit 1;`);
  const shiftTaskName = psql(`select "taskName" from "Shift" where id='${shiftId}';`);
  log("shift stores taskName as plain string (no rate link)", shiftTaskName === "キャディ業務");

  // --- ②(b) invoicing: no rate set yet -> unresolved warning, no line ---
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt")` +
      ` values (gen_random_uuid()::text, '${shiftId}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '4 hours', now(), 240, now(), now());`,
  );
  psql(`update "Company" set "agencyEnabled" = true, "teeBalance" = 10 where id = '${companyId}';` +
    `insert into "TeeLedgerEntry" (id, "companyId", type, amount, "balanceAfter", "createdAt") values (gen_random_uuid()::text, '${companyId}', 'ADJUSTMENT', 10, 10, now());`);

  const thisMonth = new Date().toISOString().slice(0, 7);
  await admin.goto(`http://localhost:3000/company/invoices?month=${thisMonth}&client=${relId}`);
  await admin.waitForTimeout(500);
  bodyText = await admin.textContent("body");
  log("invoice page shows 単価未設定 warning for the shift", bodyText.includes("単価未設定") && bodyText.includes("キャディ業務") && bodyText.includes("分離スタッフ"));

  let lineCount = psql(`select count(*) from "InvoiceLine" il join "Invoice" i on i.id=il."invoiceId" where i."companyRelationshipId"='${relId}' and il."shiftId" is not null;`);
  log("no invoice line was auto-created while rate is unset", lineCount === "0");

  // now set the rate via ContractsView (設定＞契約関連) using the SAME taskName -> should update the existing row
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.waitForTimeout(300);
  await admin.locator("select").first().selectOption({ label: "分離先" });
  await admin.locator('input[placeholder="業務内容"]').first().fill("キャディ業務");
  await admin.locator("select").nth(1).selectOption("DAILY");
  await admin.locator('input[type=number]').first().fill("9000");
  await admin.getByRole("button", { name: "＋追加" }).first().click();
  await admin.waitForTimeout(500);

  const updatedRateCount = psql(`select count(*) from "CompanyPlacementRate" where "taskName"='キャディ業務' and "companyRelationshipId"='${relId}';`);
  log("setting the rate updated the SAME row (no duplicate)", updatedRateCount === "1");
  const updatedRate = JSON.parse(
    psql(`select json_agg(json_build_object('wageType',"wageType",'amount',amount))->0 from "CompanyPlacementRate" where "taskName"='キャディ業務' and "companyRelationshipId"='${relId}';`),
  );
  log("rate now set to DAILY/9000", updatedRate.wageType === "DAILY" && Number(updatedRate.amount) === 9000);

  // re-open invoice -> line should now auto-generate at the newly-set rate
  await admin.goto(`http://localhost:3000/company/invoices?month=${thisMonth}&client=${relId}`);
  await admin.waitForTimeout(500);
  bodyText = await admin.textContent("body");
  log("unresolved warning is gone now that the rate is set", !bodyText.includes("単価未設定"));

  const line = JSON.parse(
    psql(`select json_agg(json_build_object('rate',rate,'hours',hours,'amount',amount))->0 from "InvoiceLine" il join "Invoice" i on i.id=il."invoiceId" where i."companyRelationshipId"='${relId}' and il."shiftId" is not null;`),
  );
  log("②(b) invoice line auto-generated at DAILY 9000円 (flat, not ×4h)", line && Number(line.rate) === 9000 && Number(line.hours) === 1 && Number(line.amount) === 9000);

  console.log(process.exitCode ? "TASK NAME/RATE SPLIT SMOKE TEST HAD FAILURES" : "TASK NAME/RATE SPLIT SMOKE TEST PASSED");
} catch (err) {
  console.error("TASK NAME/RATE SPLIT SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-task-rate-split-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
