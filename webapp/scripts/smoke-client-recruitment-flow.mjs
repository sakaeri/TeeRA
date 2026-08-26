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
const clientCtx = await browser.newContext();
const client = await clientCtx.newPage();
const agencyCtx = await browser.newContext();
const agency = await agencyCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const clientEmail = `crf-client-${Date.now()}@example.com`;
const agencyEmail = `crf-agency-${Date.now()}@example.com`;
const staffEmail = `crf-staff-${Date.now()}@example.com`;

try {
  // --- client company: register, will post a PUBLIC recruitment with its own wage ---
  await client.goto("http://localhost:3000/register");
  await client.fill("#name", "依頼主担当者");
  await client.fill("#email", clientEmail);
  await client.fill("#password", "password123");
  await client.click("button[type=submit]");
  await client.waitForURL("http://localhost:3000/register/company");
  await client.fill("#name", "依頼主本体株式会社");
  await client.click("button[type=submit]");
  await client.waitForURL("http://localhost:3000/company");
  const clientCompanyId = psql(`select id from "Company" where name='依頼主本体株式会社' order by "createdAt" desc limit 1;`);

  // --- agency company: register ---
  await agency.goto("http://localhost:3000/register");
  await agency.fill("#name", "派遣元担当者");
  await agency.fill("#email", agencyEmail);
  await agency.fill("#password", "password123");
  await agency.click("button[type=submit]");
  await agency.waitForURL("http://localhost:3000/register/company");
  await agency.fill("#name", "派遣元本体株式会社");
  await agency.click("button[type=submit]");
  await agency.waitForURL("http://localhost:3000/company");
  const agencyCompanyId = psql(`select id from "Company" where name='派遣元本体株式会社' order by "createdAt" desc limit 1;`);

  // --- real (non-proxy) relationship: agencyCompanyId sends staff to clientCompanyId ---
  psql(`update "Company" set "agencyEnabled" = true where id = '${agencyCompanyId}';`);
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "clientCompanyId", status, "createdAt") ` +
      `values (gen_random_uuid()::text, '${agencyCompanyId}', '${agencyCompanyId}', '${clientCompanyId}', 'ACTIVE', now()) returning id) select id from ins;`,
  );
  log("real CompanyRelationship created between the two companies", Boolean(relId));

  // --- agency: invite + register staff ---
  await agency.goto("http://localhost:3000/company/roster");
  await agency.click("text=＋スタッフを追加する");
  await agency.click("text=本アカウントを招待");
  await agency.getByRole("button", { name: "招待URLを発行する" }).click();
  await agency.waitForSelector('input[readonly]');
  const inviteUrl = await agency.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "派遣スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // --- client: post a PUBLIC recruitment with an explicit wage (¥2,500/hr) ---
  await client.goto("http://localhost:3000/company/calendar");
  await client.locator("button", { hasText: "＋" }).last().click();
  await client.getByText("募集を作成").click();
  let modal = client.locator("div.fixed.inset-0.z-20").last();
  await modal.locator('input[placeholder="例：倉庫での軽作業"]').fill("キャディ募集");
  await modal.getByRole("button", { name: "掲載する" }).click();
  await client.waitForTimeout(300);
  await modal.getByRole("button", { name: /件の募集を作成/ }).click();
  await client.waitForTimeout(600);

  const recruitmentId = psql(
    `select id from "PublicRecruitment" where "companyId"='${clientCompanyId}' order by "createdAt" desc limit 1;`,
  );
  log("client's recruitment created", Boolean(recruitmentId));

  // publish it PUBLIC with an explicit wage directly (bypassing the multi-step
  // public-switch UI which was already covered by smoke-recruitment.mjs;
  // here we only need a PUBLISHED+PUBLIC+wage row to test the invoicing fix)
  psql(
    `update "PublicRecruitment" set status='PUBLISHED', visibility='PUBLIC', "wageType"='HOURLY', "hourlyWage"=2500, "publishedAt"=now() where id='${recruitmentId}';`,
  );

  // --- agency: see the client's recruitment under the オーダー tab, assign staff ---
  await agency.goto("http://localhost:3000/company/calendar");
  await agency.waitForTimeout(300);
  const now = new Date();
  await agency.locator(`button:has-text("${now.getDate()}")`).first().click();
  await agency.waitForTimeout(300);
  const dayModal = agency.locator("div.fixed.inset-0.z-20").last();
  let bodyText = await dayModal.textContent();
  log("agency sees the client's recruitment under the オーダー tab", bodyText.includes("オーダー"));
  await dayModal.getByRole("button", { name: "オーダー", exact: true }).click();
  await agency.waitForTimeout(300);
  bodyText = await dayModal.textContent();
  log("client's recruitment title visible", bodyText.includes("キャディ募集") || bodyText.includes("依頼主本体株式会社"));

  await dayModal.getByRole("combobox").selectOption({ label: "派遣スタッフ" });
  await dayModal.getByRole("button", { name: "アサイン" }).click();
  await agency.waitForTimeout(200);
  await dayModal.getByRole("button", { name: "確定" }).click();
  await agency.waitForTimeout(600);

  const shiftId = psql(`select id from "Shift" where "staffUserId"='${staffUserId}' order by "createdAt" desc limit 1;`);
  const shiftPublicRecruitmentId = psql(`select "publicRecruitmentId" from "Shift" where id='${shiftId}';`);
  log("shift created and linked to the client's recruitment", shiftPublicRecruitmentId === recruitmentId);

  // --- ① verify: 確定スタッフ expand + ✕ (cancel) appear for this order ---
  await agency.reload();
  await agency.waitForTimeout(300);
  await agency.locator(`button:has-text("${now.getDate()}")`).first().click();
  await agency.waitForTimeout(300);
  const dayModal2 = agency.locator("div.fixed.inset-0.z-20").last();
  await dayModal2.getByRole("button", { name: "オーダー", exact: true }).click();
  await agency.waitForTimeout(300);
  bodyText = await dayModal2.textContent();
  log("① 確定スタッフ (expand) section shows the assigned staff name", bodyText.includes("確定スタッフ") && bodyText.includes("派遣スタッフ"));
  const cancelBtn = dayModal2.getByRole("button", { name: "シフトを解除" });
  log("① a ✕ (シフトを解除) button is present next to the assigned staff", await cancelBtn.count() > 0);

  // --- approve the work report, then check the invoice line uses the RECRUITMENT's wage (2500円/hr), not any placement rate ---
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt")` +
      ` values (gen_random_uuid()::text, '${shiftId}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '5 hours', now(), 300, now(), now());`,
  );
  // also seed a DIFFERENT (wrong-if-used) placement rate for this relationship, to prove it's correctly ignored
  psql(
    `insert into "CompanyPlacementRate" (id, "companyId", "companyRelationshipId", "taskName", "wageType", amount, "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${agencyCompanyId}', '${relId}', 'ダミー単価', 'HOURLY', 999, now(), now());`,
  );

  psql(`update "Company" set "teeBalance" = 10 where id = '${agencyCompanyId}';` +
    `insert into "TeeLedgerEntry" (id, "companyId", type, amount, "balanceAfter", "createdAt") values (gen_random_uuid()::text, '${agencyCompanyId}', 'ADJUSTMENT', 10, 10, now());`);

  const thisMonth = new Date().toISOString().slice(0, 7);
  await agency.goto(`http://localhost:3000/company/invoices?month=${thisMonth}&client=${relId}`);
  await agency.waitForTimeout(500);

  const line = JSON.parse(
    psql(
      `select json_agg(json_build_object('rate', rate, 'hours', hours, 'amount', amount, 'desc', description))->0 from "InvoiceLine" il join "Invoice" i on i.id=il."invoiceId" where i."companyRelationshipId"='${relId}';`,
    ),
  );
  log("②(b) invoice line uses the recruitment's own rate (2500円), not the ダミー単価(999円)", line && Number(line.rate) === 2500);
  log("②(b) invoice amount = 5h × 2500 = 12500", line && Number(line.amount) === 12500);

  console.log(process.exitCode ? "CLIENT RECRUITMENT FLOW SMOKE TEST HAD FAILURES" : "CLIENT RECRUITMENT FLOW SMOKE TEST PASSED");
} catch (err) {
  console.error("CLIENT RECRUITMENT FLOW SMOKE TEST FAILED", err);
  await client.screenshot({ path: "/tmp/smoke-crf-client-failure.png" });
  await agency.screenshot({ path: "/tmp/smoke-crf-agency-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
