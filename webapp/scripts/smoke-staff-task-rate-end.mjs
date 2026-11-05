import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 業務内容単価の「終了」：
// ・スタッフ詳細の業務内容単価から、使用済みで削除できない単価も「この日で終了」にできる
// ・終了日より前の勤務は今までの単価、終了日以降は契約書の基本給で計算する（設定漏れの警告は出さない）
// ・一覧には「終了（基本給で計算）」と出て、履歴に「単価未設定（終了）」が残る。スタッフにお知らせが届く

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
const admin = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const suffix = Date.now();
const companyName = `単価終了確認株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "単価終了本部");
  await admin.fill("#email", `rate-end-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  const adminId = psql(`select id from "User" where email='rate-end-${suffix}@example.com';`);

  // スタッフ・契約（日給9000円・2026-10-01から）・個別単価（キャディ 日給15000円・2026-10-01から）
  const staffId = psql(
    `with ins as (insert into "User" (id, email, name, "createdAt", "updatedAt") values (gen_random_uuid()::text, 'rate-end-staff-${suffix}@example.com', '単価終了花子', now(), now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);
  const templateId = psql(
    `with ins as (insert into "ContractTemplate" (id, "companyId", title, "employmentType", "workplaceType", "jobDescription", "scheduleType", "wageType", "wageAmount", "contractPeriodType", "contractStartDate", status, "requireIdDocument", "requireBankInfo", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '基本', 'PART_TIME', 'INHOUSE', '基本業務', 'SHIFT', 'DAILY', 9000, 'INDEFINITE', '2026-10-01', 'LOCKED', false, false, now()) returning id) select id from ins;`,
  );
  const contractId = psql(
    `with ins as (insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", "contractStartDate", status, "consentedAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${templateId}', '${staffId}', 9000, '2026-10-01', 'ACTIVE', now(), now()) returning id) select id from ins;`,
  );
  psql(`insert into "StaffContractWageVersion" (id, "staffContractId", "wageAmount", "effectiveFrom") values (gen_random_uuid()::text, '${contractId}', 9000, '2026-10-01');`);
  const rateId = psql(
    `with ins as (insert into "StaffTaskRate" (id, "companyId", "staffUserId", "taskName") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'キャディ') returning id) select id from ins;`,
  );
  psql(
    `insert into "StaffTaskRateVersion" (id, "staffTaskRateId", "wageType", amount, "effectiveFrom", "createdByUserId") values (gen_random_uuid()::text, '${rateId}', 'DAILY', 15000, '2026-10-01', '${adminId}');`,
  );
  // 10/5（終了前）と10/20（終了後）にキャディで出勤・承認済み（10/5の分で単価は「使用済み」になる）
  const shiftOn = (date) => {
    const id = psql(
      `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
        `values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'INHOUSE', 'キャディ', '${date}', '09:00', '17:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
    );
    psql(
      `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt") ` +
        `values (gen_random_uuid()::text, '${id}', '${staffId}', 'WORKED', 'APPROVED', '${date} 00:00:00', '${date} 08:00:00', 480, now(), now());`,
    );
    return id;
  };
  const before = shiftOn("2026-10-05");
  const after = shiftOn("2026-10-20");

  // スタッフ詳細 → 業務内容単価 → 終了
  await admin.goto("http://localhost:3000/company/roster");
  await admin.locator("tbody tr", { hasText: "単価終了花子" }).click();
  const panel = admin.locator("div.fixed.inset-0.z-30").last();
  await panel.getByRole("button", { name: "業務内容単価" }).click();
  const row = panel.locator("li", { hasText: "キャディ" }).first();
  await row.getByText("日給15000円").waitFor({ timeout: 15000 });
  await row.getByRole("button", { name: "終了", exact: true }).click();
  const dialog = admin.getByRole("dialog", { name: "単価を終了" });
  await dialog.locator('input[type="date"]').fill("2026-10-15");
  await dialog.getByRole("button", { name: "終了する" }).click();
  await dialog.waitFor({ state: "detached", timeout: 15000 });

  log(
    "終了日から単価未設定（終了）のバージョンが積まれる（前の単価は残る）",
    psql(`select count(*) from "StaffTaskRateVersion" where "staffTaskRateId"='${rateId}' and "wageType" is null and "effectiveFrom"='2026-10-15';`) === "1" &&
      psql(`select count(*) from "StaffTaskRateVersion" where "staffTaskRateId"='${rateId}' and amount=15000;`) === "1",
  );
  await row.getByText("終了（基本給で計算）").waitFor({ timeout: 15000 }).catch(() => {});
  log("一覧に「終了（基本給で計算）」と出て、終了ボタンは消える", (await row.innerText()).includes("終了（基本給で計算）") && (await row.getByRole("button", { name: "終了", exact: true }).count()) === 0);
  log(
    "スタッフにお知らせが届く",
    psql(`select count(*) from "StaffNotice" where "staffUserId"='${staffId}' and message like '%2026-10-15で終了%';`) === "1",
  );

  // 10月の給料計算：10/5は個別単価15000円、10/20は基本給9000円
  await admin.goto(`http://localhost:3000/company/payroll?month=2026-10&staff=${staffId}`);
  await admin.waitForTimeout(1500);
  const rateOf = (shiftId) => psql(`select rate from "SalarySlipLine" where "shiftId"='${shiftId}';`);
  log("終了日より前の勤務は今までの単価（15000円）", Number(rateOf(before)) === 15000);
  log("終了日以降の勤務は契約書の基本給（9000円）", Number(rateOf(after)) === 9000);
  const body = await admin.locator("main").innerText();
  log("終了した単価は「単価の設定漏れ」の警告に出ない", !body.includes("キャディ") || !/単価.*(未設定|設定されていない)/.test(body));

  console.log(process.exitCode ? "STAFF TASK RATE END SMOKE TEST HAD FAILURES" : "STAFF TASK RATE END SMOKE TEST PASSED");
} catch (err) {
  console.error("STAFF TASK RATE END SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
