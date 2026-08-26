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
  await admin.fill("#name", "単価管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "単価テスト株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  const companyId = psql(`select id from "Company" where name='単価テスト株式会社' order by "createdAt" desc limit 1;`);
  psql(`update "Company" set "teeBalance" = 10 where id = '${companyId}';` +
    `insert into "TeeLedgerEntry" (id, "companyId", type, amount, "balanceAfter", "createdAt") values (gen_random_uuid()::text, '${companyId}', 'ADJUSTMENT', 10, 10, now());`);

  // proxy client with TWO placement rates: キャディ業務(日給8000) + 作業(時給1200)
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加する");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "GREEN TABLE");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);

  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.selectOption("select", { label: "GREEN TABLE" });
  await admin.fill('input[placeholder="業務内容"]', "キャディ業務");
  await admin.locator("select").nth(1).selectOption("DAILY");
  await admin.fill('input[placeholder="金額"]', "8000");
  await admin.getByRole("button", { name: "＋追加" }).click();
  await admin.waitForTimeout(500);

  await admin.selectOption("select", { label: "GREEN TABLE" });
  await admin.fill('input[placeholder="業務内容"]', "作業");
  await admin.locator("select").nth(1).selectOption("HOURLY");
  await admin.fill('input[placeholder="金額"]', "1200");
  await admin.getByRole("button", { name: "＋追加" }).click();
  await admin.waitForTimeout(500);

  // invite + register staff
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "単価スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // assign shift 1 for today: キャディ業務 (DAILY 8000円)
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  let modal = admin.locator("div.fixed.inset-0.z-20").last();
  await modal.getByRole("button", { name: "GREEN TABLE" }).click();
  await admin.waitForTimeout(200);
  let bodyText = await modal.textContent();
  log("task selection step appears (業務内容を選択)", bodyText.includes("業務内容を選択"));
  await modal.getByRole("button", { name: /キャディ業務/ }).click();
  await modal.getByRole("button", { name: "単価スタッフ" }).click();
  await modal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  bodyText = await modal.textContent();
  log("confirm screen shows selected 業務内容 with wage info", bodyText.includes("キャディ業務") && bodyText.includes("日給8000円"));
  await modal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  const shift1Id = psql(`select id from "Shift" where "staffUserId"='${staffUserId}' order by "createdAt" desc limit 1;`);
  const shift1RateId = psql(`select "companyPlacementRateId" from "Shift" where id='${shift1Id}';`);
  log("shift 1 stored its selected companyPlacementRateId", Boolean(shift1RateId));

  // assign shift 2: 作業 (HOURLY 1200円/hr), different date to avoid conflict
  const now = new Date();
  const day2 = String(Math.min(now.getDate() + 1, 27)).padStart(2, "0");
  const day2Label = String(Number(day2));
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  modal = admin.locator("div.fixed.inset-0.z-20").last();
  await modal.getByRole("button", { name: "GREEN TABLE" }).click();
  await modal.getByRole("button", { name: /^作業/ }).click();
  await modal.getByRole("button", { name: "単価スタッフ" }).click();
  await modal.getByRole("button", { name: String(now.getDate()), exact: true }).click(); // deselect today (the default)
  await modal.getByRole("button", { name: day2Label, exact: true }).click(); // select day2 instead
  await modal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await modal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  const shift2Id = psql(
    `select id from "Shift" where "staffUserId"='${staffUserId}' and id != '${shift1Id}' order by "createdAt" desc limit 1;`,
  );

  // clock in/out both shifts, submit + approve
  for (const [sid, hoursAgo] of [[shift1Id, 8], [shift2Id, 6]]) {
    psql(
      `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt")` +
        ` values (gen_random_uuid()::text, '${sid}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '${hoursAgo} hours', now(), ${hoursAgo * 60}, now(), now())` +
        ` on conflict do nothing;`,
    );
  }

  const companyRelationshipId = psql(
    `select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' order by "createdAt" desc limit 1;`,
  );
  const thisMonth = new Date().toISOString().slice(0, 7);
  await admin.goto(`http://localhost:3000/company/invoices?month=${thisMonth}&client=${companyRelationshipId}`);
  await admin.waitForTimeout(500);
  bodyText = await admin.textContent("body");
  log("invoice shows キャディ業務 line", bodyText.includes("キャディ業務"));
  log("invoice shows 作業 line", bodyText.includes("作業"));

  const lines = JSON.parse(
    psql(
      `select json_agg(json_build_object('desc', description, 'hours', hours, 'rate', rate, 'amount', amount)) from "InvoiceLine" il join "Invoice" i on i.id = il."invoiceId" where i."companyRelationshipId"='${companyRelationshipId}';`,
    ),
  );
  const dailyLine = lines.find((l) => l.desc.includes("キャディ業務"));
  const hourlyLine = lines.find((l) => l.desc.includes("作業"));
  log("DAILY task line: hours=1 (not actual worked hours)", dailyLine && Number(dailyLine.hours) === 1);
  log("DAILY task line: rate=8000, amount=8000 (flat, not hours*rate)", dailyLine && Number(dailyLine.rate) === 8000 && Number(dailyLine.amount) === 8000);
  log("HOURLY task line: rate=1200", hourlyLine && Number(hourlyLine.rate) === 1200);
  log("HOURLY task line: amount = hours * 1200", hourlyLine && Number(hourlyLine.amount) === Number(hourlyLine.hours) * 1200);
  log("the two tasks use DIFFERENT rates (not both defaulting to the oldest one)", dailyLine && hourlyLine && Number(dailyLine.rate) !== Number(hourlyLine.rate));

  console.log(process.exitCode ? "TASK RATE SMOKE TEST HAD FAILURES" : "TASK RATE SMOKE TEST PASSED");
} catch (err) {
  console.error("TASK RATE SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-task-rate-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
