import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

// 給与明細のSHIFT由来の行を削除しても、ページを開き直すたび
// （getOrCreateSalarySlip→regenerateShiftLinesが毎月承認済み実績から
// 自動生成し直していたため）に復活してしまっていたバグを検証する
// （invoicing.tsの同じ修正パターン参照。isManuallyEditedは既存行の
// 上書き防止であって、削除済みのshiftIdを覚えておく仕組みではなかった）。

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
const adminEmail = `prdel-admin-${suffix}@example.com`;
const staffEmail = `prdel-staff-${suffix}@example.com`;
const today = new Date().toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "給与削除確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "給与削除確認株式会社" + suffix);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  const companyId = psql(`select id from "Company" where name='給与削除確認株式会社${suffix}';`);

  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "給与削除確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("レジ業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1300");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);

  const payrollStaffUserId = psql(`select id from "User" where email='${staffEmail}';`);
  const templateId = psql(`select id from "ContractTemplate" where "companyId"='${companyId}' order by "createdAt" desc limit 1;`);
  const wageAmount = psql(`select "wageAmount" from "ContractTemplate" where id='${templateId}';`);
  const staffContractId = psql(
    `with ins as (insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", "contractStartDate", status, "consentedAt", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${templateId}', '${payrollStaffUserId}', ${wageAmount}, current_date - interval '7 day', 'ACTIVE', now(), now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "StaffContractWageVersion" (id, "staffContractId", "wageAmount", "effectiveFrom", "createdAt") ` +
      `values (gen_random_uuid()::text, '${staffContractId}', ${wageAmount}, current_date - interval '7 day', now());`,
  );
  psql(`update "ContractTemplate" set status='LOCKED' where id='${templateId}';`);

  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  const assignModal1 = admin.locator("div.fixed.inset-0.z-20").last();
  await assignModal1.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await assignModal1.getByRole("button", { name: "＋ 新しい業務内容を追加する" }).click();
  await assignModal1.locator('input[placeholder*="業務内容"]').fill("通常業務");
  await assignModal1.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal1.getByRole("button", { name: "給与削除確認スタッフ" }).click();
  await assignModal1.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal1.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  const shiftId = psql(`select id from "Shift" where "staffUserId"='${payrollStaffUserId}' order by "createdAt" desc limit 1;`);

  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.getByRole("button", { name: "勤務開始" }).click();
  await staff.waitForTimeout(500);
  psql(`update "WorkReport" set "clockIn" = now() - interval '8 hours' where "shiftId"='${shiftId}';`);
  await staff.getByRole("button", { name: "勤務終了" }).click();
  await staff.waitForTimeout(500);
  await staff.getByRole("button", { name: "業務報告を提出する" }).click();
  await staff.waitForTimeout(600);

  await admin.goto("http://localhost:3000/company/settings?tab=workreports");
  await admin.getByRole("button", { name: "承認する" }).click();
  await admin.waitForTimeout(600);

  const payrollUrl = `http://localhost:3000/company/payroll?month=${thisMonth}&staff=${payrollStaffUserId}`;
  await admin.goto(payrollUrl);
  await admin.waitForTimeout(400);
  const rateInputValue = await admin.locator("table input[type=number]").nth(1).inputValue();
  log("auto-generated shift line with rate 1300 before delete", rateInputValue === "1300");

  const slipId = psql(`select id from "SalarySlip" where "companyId"='${companyId}' and "staffUserId"='${payrollStaffUserId}';`);

  // --- SHIFT行を削除して、ページを開き直しても消えたままか ---
  await admin.locator("table").getByRole("button", { name: "✕", exact: true }).first().click();
  await admin.waitForTimeout(500);
  let body = await admin.locator("body").innerText();
  log("削除直後は明細から消える", !body.includes("レジ業務") && !/1,?300円/.test(body));

  const excludedShiftIds = psql(`select "excludedShiftIds"::text from "SalarySlip" where id='${slipId}';`);
  log("削除したshiftIdがexcludedShiftIdsに記録される", excludedShiftIds.includes(shiftId));

  await admin.goto(payrollUrl);
  await admin.waitForTimeout(400);
  body = await admin.locator("body").innerText();
  log("ページを開き直しても削除した行は復活しない", !body.includes("レジ業務") && !/1,?300円/.test(body));

  const lineCountAfterReload = psql(
    `select count(*) from "SalarySlipLine" where "salarySlipId"='${slipId}' and "shiftId"='${shiftId}';`,
  );
  log("DB上にも復活した行がない", lineCountAfterReload === "0");

  console.log(
    process.exitCode
      ? "PAYROLL LINE DELETE PERSISTENCE SMOKE TEST HAD FAILURES"
      : "PAYROLL LINE DELETE PERSISTENCE SMOKE TEST PASSED",
  );
} catch (err) {
  console.error("PAYROLL LINE DELETE PERSISTENCE SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
