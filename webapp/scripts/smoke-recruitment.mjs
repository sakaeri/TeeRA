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

const adminEmail = `recruit-admin-${Date.now()}@example.com`;
const staffEmail = `recruit-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "募集管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "募集テスト株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  const companyId = psql(
    `select id from "Company" where name='募集テスト株式会社' order by "createdAt" desc limit 1;`,
  );

  // grant 100 Tee via a consistent ledger entry (stand-in for Stripe/bank charge, task 14)
  psql(
    `update "Company" set "teeBalance" = 100 where id = '${companyId}';` +
      `insert into "TeeLedgerEntry" (id, "companyId", type, amount, "balanceAfter", "createdAt") values (gen_random_uuid()::text, '${companyId}', 'ADJUSTMENT', 100, 100, now());`,
  );

  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを招待する");
  await admin.click("text=本アカウントを招待");
  await admin.waitForSelector("text=招待URL:");
  const bodyText = await admin.textContent("body");
  const inviteUrl = bodyText.match(/http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]+/)[0];

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "募集スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  // create a public recruitment with maxEntries=3 (30 Tee) out of 100 balance
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("オーダー募集").click();
  await admin.waitForSelector('input[type="date"]');
  const bodyBeforeFill = await admin.textContent("body");
  log("affordable cap shown as 10 (100 Tee / 10)", bodyBeforeFill.includes("残高で賄える上限: 10名"));

  const recruitmentTitle = `キッチンスタッフ募集${Date.now()}`;
  const titleInput = admin.locator("label:has-text('タイトル') input");
  await titleInput.fill(recruitmentTitle);
  const maxEntriesInput = admin.locator("label:has-text('募集人数の上限') input");
  await maxEntriesInput.fill("3");
  await admin.getByRole("button", { name: "公開する" }).click();
  await admin.waitForTimeout(800);

  const balanceAfterCreate = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("balance locked 30 Tee (100 -> 70)", balanceAfterCreate === 70);

  let calBody = await admin.textContent("body");
  log("recruitment listed with 残り3名", calBody.includes("残り3名"));

  // staff applies
  await staff.goto("http://localhost:3000/staff/recruitments");
  let staffBody = await staff.textContent("body");
  log("staff sees open recruitment", staffBody.includes(recruitmentTitle));

  const recruitmentItem = staff.locator("li", { hasText: recruitmentTitle });
  await recruitmentItem.getByRole("button", { name: "応募する" }).click();
  await staff.waitForTimeout(800);
  staffBody = await staff.textContent("body");
  log("staff shows applied", staffBody.includes("応募済み"));

  const balanceAfterApply = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("balance unchanged on apply (already locked)", balanceAfterApply === 70);

  await admin.reload();
  calBody = await admin.textContent("body");
  log("admin sees 残り2名 after one application", calBody.includes("残り2名"));

  const shiftCount = Number(
    psql(
      `select count(*) from "Shift" where "publicRecruitmentId" is not null and "companyId"='${companyId}';`,
    ),
  );
  log("a Shift row was created for the applicant", shiftCount === 1);

  console.log(process.exitCode ? "RECRUITMENT SMOKE TEST HAD FAILURES" : "RECRUITMENT SMOKE TEST PASSED");
} catch (err) {
  console.error("RECRUITMENT SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-recruitment-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-recruitment-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
