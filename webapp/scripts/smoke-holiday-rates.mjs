import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 祝日の表示と、土日祝の単価（請求・給与）を検証する：
// ・カレンダーで祝日（2026-11-03 文化の日）が赤く、日別詳細に祝日名が出る
// ・単価タブ・業務内容単価タブで土日祝の金額を入れられ、一覧に表示される
// ・請求書・給与明細で、平日は平日単価、土日祝は土日祝単価で計算される

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
const page = await (await browser.newContext()).newPage();
const suffix = Date.now();
const companyName = `土日祝単価株式会社${suffix}`;
const clientName = `土日祝ゴルフ場${suffix}`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "土日祝管理者");
  await page.fill("#email", `holiday-admin-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  // 請求書（派遣・請負の機能）を使うため
  psql(`update "Company" set "agencyEnabled" = true where id = '${companyId}';`);

  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") values (gen_random_uuid()::text, '${companyId}', '${companyId}', '${clientName}', 'ACTIVE', now()) returning id) select id from ins;`,
  );
  const staffId = psql(
    `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'holiday-staff-${suffix}@example.com', 'x', '土日祝スタッフ', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);

  // 雇用契約（給与計算の前提）
  await page.goto("http://localhost:3000/company/settings?tab=contracts");
  await page.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await page.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("基本業務");
  await page.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("HOURLY");
  await page.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1000");
  await page.getByRole("button", { name: "テンプレートを生成" }).click();
  await page.waitForTimeout(600);
  const templateId = psql(`select id from "ContractTemplate" where "companyId"='${companyId}' limit 1;`);
  const contractId = psql(
    `with ins as (insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", "contractStartDate", status, "consentedAt", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${templateId}', '${staffId}', 1000, current_date - interval '7 day', 'ACTIVE', now(), now(), now()) returning id) select id from ins;`,
  );
  psql(`insert into "StaffContractWageVersion" (id, "staffContractId", "wageAmount", "effectiveFrom", "createdAt") values (gen_random_uuid()::text, '${contractId}', 1000, current_date - interval '7 day', now());`);
  psql(`update "ContractTemplate" set status='LOCKED' where id='${templateId}';`);

  // --- 依頼主の単価タブ：平日2000円／土日祝2500円 ---
  await page.goto("http://localhost:3000/company/roster");
  await page.click("text=依頼主一覧");
  await page.waitForTimeout(300);
  await page.getByText(clientName).first().click();
  await page.waitForTimeout(500);
  const clientPanel = page.locator("div.fixed.inset-0.z-30").last();
  await clientPanel.getByRole("button", { name: "単価", exact: true }).click();
  await clientPanel.getByRole("button", { name: "＋業務内容を追加" }).click();
  await page.waitForTimeout(300);
  const newRateModal = page.locator("div.fixed.inset-0").last();
  await newRateModal.locator('input[placeholder*="業務内容"]').fill("キャディ");
  await newRateModal.locator('input[placeholder="金額"]').fill("2000");
  await newRateModal.locator('input[placeholder="土日祝（任意）"]').fill("2500");
  await newRateModal.getByRole("button", { name: "追加", exact: true }).click();
  await page.waitForTimeout(800);
  const clientText = await clientPanel.innerText();
  log("単価タブに平日・土日祝の単価が出る", clientText.includes("時給2000円／土日祝2500円"));
  log("キャンセル規定が未設定なら「未設定」と出る", clientText.includes("キャンセル規定：未設定"));
  await clientPanel.getByText("閉じる").first().click();
  await page.waitForTimeout(300);

  // --- スタッフの業務内容単価：平日1200円／土日祝1500円 ---
  await page.goto(`http://localhost:3000/company/roster?staff=${staffId}`);
  await page.waitForTimeout(800);
  const staffPanel = page.locator("div.fixed.inset-0.z-30").last();
  await staffPanel.getByRole("button", { name: "業務内容単価" }).click();
  await staffPanel.getByRole("button", { name: "＋業務内容を追加" }).click();
  await page.waitForTimeout(300);
  const staffRateModal = page.locator("div.fixed.inset-0").last();
  const taskInput = staffRateModal.locator('input[placeholder*="業務内容"]');
  if (await taskInput.count()) await taskInput.fill("キャディ");
  else await staffRateModal.locator("select").first().selectOption("キャディ");
  await staffRateModal.locator('input[placeholder="金額"]').fill("1200");
  await staffRateModal.locator('input[placeholder="土日祝（任意）"]').fill("1500");
  await staffRateModal.getByRole("button", { name: "追加", exact: true }).click();
  await page.waitForTimeout(800);
  log("業務内容単価タブに平日・土日祝の単価が出る", (await staffPanel.innerText()).includes("時給1200円／土日祝1500円"));

  // --- 祝日(11/3 火)・平日(11/4 水)・土曜(11/7) に各4時間の承認済み勤務 ---
  const shiftOn = (date) => {
    const id = psql(
      `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'CLIENT', '${relId}', 'キャディ', '${date}', '08:00', '12:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
    );
    psql(
      `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "submittedAt", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${id}', '${staffId}', 'WORKED', 'APPROVED', '${date} 08:00'::timestamp - interval '9 hours', '${date} 12:00'::timestamp - interval '9 hours', 240, now(), now(), now());`,
    );
    return id;
  };
  const holidayShift = shiftOn("2026-11-03");
  const weekdayShift = shiftOn("2026-11-04");
  const saturdayShift = shiftOn("2026-11-07");

  // --- 請求書 ---
  await page.goto(`http://localhost:3000/company/invoices?month=2026-11&client=${relId}`);
  await page.waitForTimeout(1500);
  const invoiceLine = (shiftId) =>
    psql(`select rate || '|' || description from "InvoiceLine" where "shiftId"='${shiftId}' limit 1;`);
  log("請求：祝日は土日祝単価2500円", invoiceLine(holidayShift).startsWith("2500|") && invoiceLine(holidayShift).includes("（土日祝）"));
  log("請求：平日は平日単価2000円", invoiceLine(weekdayShift).startsWith("2000|") && !invoiceLine(weekdayShift).includes("土日祝"));
  log("請求：土曜は土日祝単価2500円", invoiceLine(saturdayShift).startsWith("2500|"));

  // --- 給与明細 ---
  await page.goto(`http://localhost:3000/company/payroll?month=2026-11&staff=${staffId}`);
  await page.waitForTimeout(1500);
  const slipLine = (shiftId) => psql(`select rate || '|' || description from "SalarySlipLine" where "shiftId"='${shiftId}' and kind='SHIFT' limit 1;`);
  log("給与：祝日は土日祝単価1500円", slipLine(holidayShift).startsWith("1500|") && slipLine(holidayShift).includes("（土日祝）"));
  log("給与：平日は平日単価1200円", slipLine(weekdayShift).startsWith("1200|"));
  log("給与：土曜は土日祝単価1500円", slipLine(saturdayShift).startsWith("1500|"));

  // --- カレンダーの祝日表示 ---
  await page.goto("http://localhost:3000/company/calendar?y=2026&m=11");
  await page.waitForTimeout(800);
  const day3 = page.locator('button:has(> span:text-is("3"))').first().locator("> span").first();
  const day4 = page.locator('button:has(> span:text-is("4"))').first().locator("> span").first();
  log("祝日（11/3）は赤", ((await day3.getAttribute("class")) ?? "").includes("text-red-600") && (await day3.getAttribute("title")) === "文化の日");
  log("平日（11/4）は赤くない", !((await day4.getAttribute("class")) ?? "").includes("text-red-600"));
  await page.locator('button:has(> span:text-is("3"))').first().click();
  await page.waitForTimeout(400);
  log("日別詳細に祝日名が出る", (await page.locator("div.fixed.inset-0.z-20").last().innerText()).includes("11月3日（火・文化の日）"));

  console.log(process.exitCode ? "HOLIDAY RATES SMOKE TEST HAD FAILURES" : "HOLIDAY RATES SMOKE TEST PASSED");
} finally {
  await browser.close();
}
