import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 手当（帯同手当・チップなど）：
// ・設定＞手当で名前を自由に作れる（決まった金額／毎回入れる・依頼主にも請求する・スタッフも選べる）
// ・スタッフが業務報告で手当を選べる（毎回入れる手当は金額も）
// ・給料明細に手当の行が入る。依頼主への請求書には「請求する」にした手当だけが入る
// ・会社は業務報告の詳細で手当を付け外しできる
// ・業務内容をまとめる時に、まとめた勤務へ手当を付けられる

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
const admin = await (await browser.newContext()).newPage();
admin.on("dialog", (d) => d.accept());
const staff = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const suffix = Date.now();
const companyName = `手当株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "手当管理者");
  await admin.fill("#email", `allow-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  psql(`update "Company" set "agencyEnabled"=true where id='${companyId}';`);

  // スタッフを招待
  await admin.goto("http://localhost:3000/company/roster");
  await admin.getByText("＋スタッフを追加").first().click();
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "手当スタッフ");
  await staff.fill("#email", `allow-staff-${suffix}@example.com`);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffId = psql(`select id from "User" where email='allow-staff-${suffix}@example.com';`);

  // 契約（日給11,000円）・依頼主（キャディ 日給15,000円）
  const tpl = psql(
    `insert into "ContractTemplate" (id, "companyId", title, "employmentType", "workplaceType", "jobDescription", "scheduleType", "wageType", "wageAmount", "contractPeriodType", "contractStartDate", status, "updatedAt") values (gen_random_uuid()::text, '${companyId}', 'アルバイト契約', 'PART_TIME', 'INHOUSE', 'キャディ', 'SHIFT', 'DAILY', 11000, 'INDEFINITE', '2026-01-01', 'LOCKED', now()) returning id;`,
  );
  const contractId = psql(
    `insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", "contractStartDate", status, "consentedAt", "updatedAt") values (gen_random_uuid()::text, '${tpl}', '${staffId}', 11000, '2026-01-01', 'ACTIVE', now(), now()) returning id;`,
  );
  psql(`insert into "StaffContractWageVersion" (id, "staffContractId", "wageAmount", "effectiveFrom") values (gen_random_uuid()::text, '${contractId}', 11000, '2026-01-01');`);
  const relId = psql(
    `insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") values (gen_random_uuid()::text, '${companyId}', '${companyId}', '手当ゴルフ倶楽部', 'ACTIVE', now()) returning id;`,
  );
  psql(`insert into "StaffPlacement" (id, "staffUserId", "companyRelationshipId", active, "createdAt") values (gen_random_uuid()::text, '${staffId}', '${relId}', true, now());`);
  for (const [name, amount] of [["キャディ", 15000], ["帯同研修キャディ", 15000]]) {
    const rateId = psql(
      `insert into "CompanyPlacementRate" (id, "companyId", "companyRelationshipId", "taskName") values (gen_random_uuid()::text, '${companyId}', '${relId}', '${name}') returning id;`,
    );
    psql(`insert into "CompanyPlacementRateVersion" (id, "placementRateId", "wageType", amount, "effectiveFrom", "createdAt") values (gen_random_uuid()::text, '${rateId}', 'DAILY', ${amount}, '2020-01-01', now());`);
  }

  // --- 設定＞手当で2つ作る ---
  await admin.goto("http://localhost:3000/company/settings?tab=allowances");
  const settings = admin.getByTestId("allowances-settings");
  await settings.waitFor();
  const dialog = admin.getByRole("dialog", { name: "手当" });
  await settings.getByRole("button", { name: "＋手当を追加" }).click();
  await dialog.getByLabel("手当の名前", { exact: true }).fill("帯同手当");
  await dialog.getByLabel("1回の金額").fill("1000");
  await dialog.getByRole("button", { name: "保存" }).click();
  await dialog.waitFor({ state: "detached" });
  await settings.getByRole("button", { name: "＋手当を追加" }).click();
  await dialog.getByLabel("手当の名前", { exact: true }).fill("チップ");
  await dialog.getByRole("button", { name: "毎回入れる" }).click();
  await dialog.getByText("依頼主にも請求する").click();
  await dialog.getByRole("button", { name: "保存" }).click();
  await dialog.waitFor({ state: "detached" });
  await admin.waitForTimeout(500);
  log("名前を自由に付けて手当を作れる（2件）", (await settings.getByTestId("allowance-row").count()) === 2);
  const chipRow = settings.getByTestId("allowance-row").filter({ hasText: "チップ" });
  log("チップは「金額は毎回入れる・依頼主にも請求」", (await chipRow.innerText()).includes("金額は毎回入れる") && (await chipRow.innerText()).includes("依頼主にも請求"));
  const bandoId = psql(`select id from "Allowance" where "companyId"='${companyId}' and name='帯同手当';`);

  // --- スタッフ：業務報告で帯同手当とチップ3,000円を選んで提出 ---
  const pastDate = psql(`select ((now() at time zone 'Asia/Tokyo')::date - 2)::text;`);
  const shiftId = psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", date, "startTime", "endTime", "taskName", status, "createdVia", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'CLIENT', '${relId}', '${pastDate}', '08:00', '17:00', 'キャディ', 'CONFIRMED', 'ASSIGN', now()) returning id;`,
  );
  await staff.goto("http://localhost:3000/staff/timecard");
  const card = staff.locator("li", { hasText: pastDate }).first();
  const picker = card.getByTestId("allowance-picker");
  await picker.waitFor();
  await card.locator('input[type="time"]').first().fill("08:00");
  await card.locator('input[type="time"]').nth(1).fill("17:00");
  await picker.getByLabel("帯同手当").check();
  await picker.getByLabel("チップ", { exact: true }).check();
  log("毎回入れる手当は、金額を入れるまで提出できない", await card.getByRole("button", { name: "業務報告を提出する" }).isDisabled());
  await picker.getByLabel("チップの金額").fill("3000");
  await card.getByRole("button", { name: "業務報告を提出する" }).click();
  await staff.waitForTimeout(1500);
  const rows = psql(
    `select string_agg(a.name||':'||sa.amount||':'||coalesce(sa."clientAmount"::text,'-'), ',' order by a.name) from "ShiftAllowance" sa join "Allowance" a on a.id=sa."allowanceId" where sa."shiftId"='${shiftId}';`,
  );
  log("業務報告で選んだ手当が勤務に付く（帯同手当は請求しない・チップは請求する）", rows === "チップ:3000:3000,帯同手当:1000:-");

  // 承認
  psql(`update "WorkReport" set "approvalStatus"='APPROVED', "approvedAt"=now() where "shiftId"='${shiftId}';`);
  const month = pastDate.slice(0, 7);

  // --- 給料明細に手当の行が入る ---
  await admin.goto(`http://localhost:3000/company/payroll?month=${month}&staff=${staffId}`);
  await admin.locator("tr[data-kind=ALLOWANCE]").first().waitFor({ timeout: 15000 });
  const slipLines = psql(
    `select string_agg(l.kind||':'||l.amount, ',' order by l.kind::text, l.amount) from "SalarySlipLine" l join "SalarySlip" s on s.id=l."salarySlipId" where s."staffUserId"='${staffId}' and s."targetMonth"='${month}';`,
  );
  log("給料明細：勤務11,000円＋帯同手当1,000円＋チップ3,000円", slipLines === "ALLOWANCE:1000,ALLOWANCE:3000,SHIFT:11000");
  const slipId = psql(`select id from "SalarySlip" where "staffUserId"='${staffId}' and "targetMonth"='${month}';`);
  const pdf = await admin.request.get(`http://localhost:3000/api/salary-slips/${slipId}/pdf`);
  log("手当の行が入った給料明細のPDFを作れる", pdf.ok() && (pdf.headers()["content-type"] ?? "").includes("pdf"));
  log("給料明細の手当の行は✕で消せない（業務報告の詳細で付け外しする）", (await admin.locator("tr[data-kind=ALLOWANCE]").first().getByRole("button", { name: "✕" }).count()) === 0);

  // --- 依頼主への請求書：チップだけ入る ---
  await admin.goto(`http://localhost:3000/company/invoices?month=${month}&client=${relId}`);
  await admin.waitForTimeout(2000);
  const invoiceLines = psql(
    `select string_agg(regexp_replace(description, '^[0-9-]+ ', '')||':'||amount, ',' order by amount) from "InvoiceLine" where "invoiceId"=(select id from "Invoice" where "companyRelationshipId"='${relId}' limit 1);`,
  );
  log("依頼主への請求書：キャディ15,000円とチップ3,000円（帯同手当は入らない）", invoiceLines === "チップ:3000,勤務（キャディ）:15000");

  // --- 会社：業務報告の詳細でチップを外す ---
  await admin.goto(`http://localhost:3000/company/roster`);
  await admin.click("text=手当スタッフ");
  const panel = admin.locator("div.fixed.inset-0.z-30").last();
  await panel.getByText(pastDate.slice(5)).first().click();
  const detail = admin.getByRole("dialog", { name: "業務報告の詳細" });
  const section = detail.getByTestId("report-allowances");
  await section.waitFor({ timeout: 10000 });
  log("業務報告の詳細に付いている手当が出る", (await section.getByTestId("report-allowance-row").count()) === 2);
  await section.getByRole("button", { name: "直す" }).click();
  await section.getByLabel("チップ", { exact: true }).uncheck();
  await section.getByRole("button", { name: "保存" }).click();
  await admin.waitForTimeout(1200);
  log("会社が手当を外せる", psql(`select count(*) from "ShiftAllowance" where "shiftId"='${shiftId}';`) === "1");

  // --- 業務内容をまとめる時に手当を付ける：帯同研修キャディ → キャディ＋帯同手当 ---
  const otherDate = psql(`select ((now() at time zone 'Asia/Tokyo')::date - 3)::text;`);
  const bandoShift = psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", date, "startTime", "endTime", "taskName", status, "createdVia", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'CLIENT', '${relId}', '${otherDate}', '08:00', '17:00', '帯同研修キャディ', 'CONFIRMED', 'ASSIGN', now()) returning id;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "computedMinutes", "approvalStatus", "submittedAt", "updatedAt") values (gen_random_uuid()::text, '${bandoShift}', '${staffId}', 'WORKED', 480, 'APPROVED', now(), now());`,
  );
  await admin.goto(`http://localhost:3000/company/roster?client=${relId}&clientTab=rates`);
  await admin.getByRole("button", { name: "業務内容をまとめる" }).first().click();
  const modal = admin.getByTestId("task-name-merge-modal");
  await modal.waitFor();
  await modal.getByTestId("merge-from").selectOption("帯同研修キャディ");
  await modal.getByTestId("merge-to").selectOption("キャディ");
  await modal.getByTestId("merge-allowance").selectOption(bandoId);
  await modal.getByRole("button", { name: "まとめる", exact: true }).click();
  await modal.waitFor({ state: "detached", timeout: 15000 });
  log("まとめた勤務は「キャディ」になる", psql(`select "taskName" from "Shift" where id='${bandoShift}';`) === "キャディ");
  log(
    "まとめた勤務に帯同手当が付く（ほかの勤務には付けない）",
    psql(`select count(*) from "ShiftAllowance" where "shiftId"='${bandoShift}' and "allowanceId"='${bandoId}';`) === "1" &&
      psql(`select count(*) from "ShiftAllowance" where "shiftId"='${shiftId}';`) === "1",
  );

  // --- しまった手当はスタッフの候補に出ない ---
  await admin.goto("http://localhost:3000/company/settings?tab=allowances");
  await settings.getByTestId("allowance-row").filter({ hasText: "チップ" }).getByRole("button", { name: "しまう" }).click();
  await admin.waitForTimeout(800);
  const nextShift = psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", date, "startTime", "endTime", "taskName", status, "createdVia", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'CLIENT', '${relId}', '${psql(`select ((now() at time zone 'Asia/Tokyo')::date - 1)::text;`)}', '08:00', '17:00', 'キャディ', 'CONFIRMED', 'ASSIGN', now()) returning id;`,
  );
  void nextShift;
  await staff.goto("http://localhost:3000/staff/timecard");
  const nextPicker = staff.getByTestId("allowance-picker").first();
  await nextPicker.waitFor();
  log("しまった手当は、スタッフの選ぶ候補に出ない", (await nextPicker.getByLabel("チップ", { exact: true }).count()) === 0 && (await nextPicker.getByLabel("帯同手当").count()) === 1);

  console.log(process.exitCode ? "ALLOWANCES SMOKE TEST HAD FAILURES" : "ALLOWANCES SMOKE TEST PASSED");
} catch (err) {
  console.error("ALLOWANCES SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-allowances-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-allowances-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
