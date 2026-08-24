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
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "募集スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  const today = new Date().toISOString().slice(0, 10);

  // create an order (自社/配属スタッフ限定, free) with maxEntries=3 — no Tee
  // should move until it's later switched to 公開募集.
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("オーダー募集").click();
  await admin.waitForSelector("text=オーダー募集を作成");
  const bodyBeforeFill = await admin.textContent("body");
  log("order creation form has no 時給/Tee-cap fields", !bodyBeforeFill.includes("時給") && !bodyBeforeFill.includes("残高で賄える"));

  const recruitmentTitle = `キッチンスタッフ募集${Date.now()}`;
  const titleInput = admin.locator('input[type="text"]').first();
  await titleInput.fill(recruitmentTitle);
  const maxEntriesInput = admin.locator("label:has-text('募集人数') input").first();
  await maxEntriesInput.fill("3");
  await admin.getByRole("button", { name: "掲載する" }).click();
  await admin.waitForTimeout(800);

  const balanceAfterCreate = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("order creation does not touch Tee balance (100 -> 100)", balanceAfterCreate === 100);

  // the old bottom-of-calendar 公開募集一覧 panel is gone — remaining-slot
  // count now shows as a pill on the オーダー tab inside the day-detail
  // modal, so open it via the date query param to check.
  await admin.goto(`http://localhost:3000/company/calendar?date=${today}`);
  await admin.waitForTimeout(600);
  let calBody = await admin.locator(".fixed.inset-0.z-20").first().innerText();
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
  log("balance unchanged on apply (order entries stay free)", balanceAfterApply === 100);

  await admin.reload();
  await admin.waitForTimeout(600);
  calBody = await admin.locator(".fixed.inset-0.z-20").first().innerText();
  log("admin sees 残り2名 after one application", calBody.includes("残り2名"));

  const shiftCount = Number(
    psql(
      `select count(*) from "Shift" where "publicRecruitmentId" is not null and "companyId"='${companyId}';`,
    ),
  );
  log("a Shift row was created for the applicant", shiftCount === 1);

  // switch the order to 公開募集 (billing only starts here now) — 2 of 3
  // slots remain unfilled, so 2 × 10 Tee should get locked.
  await admin.goto(`http://localhost:3000/company/calendar?date=${today}`);
  await admin.waitForTimeout(600);
  await admin
    .locator(".fixed.inset-0.z-20")
    .first()
    .getByRole("button", { name: /^オーダー/ })
    .click();
  await admin.waitForTimeout(300);
  await admin.locator(".fixed.inset-0.z-20").first().getByRole("button", { name: "編集" }).click();
  await admin.waitForTimeout(300);
  const editModal = admin.locator(".fixed.inset-0.z-20").nth(1);
  await editModal.getByRole("button", { name: "公開募集に切り替える" }).click();
  await editModal.locator('input[type="number"]').last().fill("1200");
  const confirmBoxes = editModal.locator('input[type="checkbox"]');
  await confirmBoxes.nth(0).check();
  await confirmBoxes.nth(1).check();
  await confirmBoxes.nth(2).check();
  await editModal.getByRole("button", { name: "公開募集を開始する" }).click();
  await admin.waitForTimeout(700);

  const afterSwitch = psql(`select visibility, "lockedTee" from "PublicRecruitment" where "companyId"='${companyId}' and title='${recruitmentTitle}';`);
  log("switching to 公開募集 locks Tee only for the remaining 2 slots", afterSwitch === "PUBLIC|20");
  const balanceAfterSwitch = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("balance debited by exactly the newly-locked amount (100 -> 80)", balanceAfterSwitch === 80);

  console.log(process.exitCode ? "RECRUITMENT SMOKE TEST HAD FAILURES" : "RECRUITMENT SMOKE TEST PASSED");
} catch (err) {
  console.error("RECRUITMENT SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-recruitment-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-recruitment-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
