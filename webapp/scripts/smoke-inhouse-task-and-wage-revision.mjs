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
const admin = await (await browser.newContext()).newPage();
const staff = await (await browser.newContext()).newPage();
const staff2 = await (await browser.newContext()).newPage();

const adminEmail = `inhousetask-admin-${Date.now()}@example.com`;
const staffEmail = `inhousetask-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "自社業務内容確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "自社業務内容確認株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='自社業務内容確認株式会社' order by "createdAt" desc limit 1;`);

  // invite + register staff
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "自社確認花子");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // base HOURLY 1000円 contract
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("基本業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("HOURLY");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1000");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);

  // スタッフの自由選択は廃止済み（契約書は管理者が用意し本人が同意する形）
  // なので、このテストの本題（業務内容単価・基本給改定）とは無関係な契約
  // 締結手順はUIを通さず直接ACTIVEな契約として投入する。
  const baseTemplateId = psql(`select id from "ContractTemplate" where "companyId"='${companyId}' order by "createdAt" desc limit 1;`);
  const baseWageAmount = psql(`select "wageAmount" from "ContractTemplate" where id='${baseTemplateId}';`);
  // 契約開始日はテンプレートの日付（todayJst()由来）に合わせず確実に過去日に
  // する — JSTとUTCの「今日」がずれる時間帯にシフト日付が契約開始日より
  // 前と誤判定されるのを避けるため。
  const baseStaffContractId = psql(
    `with ins as (insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", "contractStartDate", status, "consentedAt", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${baseTemplateId}', '${staffUserId}', ${baseWageAmount}, current_date - interval '7 day', 'ACTIVE', now(), now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "StaffContractWageVersion" (id, "staffContractId", "wageAmount", "effectiveFrom", "createdAt") ` +
      `values (gen_random_uuid()::text, '${baseStaffContractId}', ${baseWageAmount}, current_date - interval '7 day', now());`,
  );
  psql(`update "ContractTemplate" set status='LOCKED' where id='${baseTemplateId}';`);
  const staffContractId = psql(
    `select sc.id from "StaffContract" sc where sc."staffUserId"='${staffUserId}' and sc.status='ACTIVE' order by sc."createdAt" desc limit 1;`,
  );

  // --- ① 自社勤務でも業務内容ステップが出て、選んだ業務内容がShift.taskNameに入る
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  const modal = admin.locator("div.fixed.inset-0.z-20").last();
  await modal.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await admin.waitForTimeout(150);
  const taskHeading = await modal.getByRole("heading", { name: /・業務内容を選択/ }).count();
  log("自社勤務でも業務内容選択ステップが表示される", taskHeading > 0);
  await modal.getByRole("button", { name: "＋ 新しい業務内容を追加する" }).click();
  await modal.locator('input[placeholder*="業務内容"]').fill("清掃業務");
  await modal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await admin.waitForTimeout(300);
  await modal.getByRole("button", { name: "自社確認花子" }).click();
  await modal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await modal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  const shiftTaskName = psql(
    `select "taskName" from "Shift" where "staffUserId"='${staffUserId}' order by "createdAt" desc limit 1;`,
  );
  log("自社シフトのShift.taskNameに選んだ業務内容が保存される", shiftTaskName === "清掃業務");

  const registeredInCompanyWide = psql(
    `select count(*) from "CompanyPlacementRate" where "companyId"='${companyId}' and "companyRelationshipId" is null and "taskName"='清掃業務';`,
  );
  log("自社向けの業務内容が会社共通の登録一覧にも載る（companyRelationshipId=null）", registeredInCompanyWide === "1");

  // --- ③ 雇用契約書の基本給を改定 → 上書き＋お知らせ（結び直し不要）
  // 業務内容単価タブに「基本給」行として並び、そこから改定する
  // （契約書管理タブは契約の中身の確認用のみ）。
  await admin.goto("http://localhost:3000/company/roster");
  await admin.locator("tbody tr", { hasText: "自社確認花子" }).click();
  await admin.waitForTimeout(300);
  const panel = admin.locator("div.fixed.inset-0.z-30").last();
  await panel.getByRole("button", { name: "契約書管理" }).click();
  log(
    "契約書管理タブに「基本給を改定」ボタンは無い（業務内容単価タブに統一）",
    (await panel.getByRole("button", { name: "基本給を改定" }).count()) === 0,
  );
  await panel.getByRole("button", { name: "業務内容単価" }).click();
  const baseWageRow = panel.locator("li", { hasText: "基本給" });
  log("業務内容単価タブに「基本給」の行が他の単価と並んで表示される", (await baseWageRow.count()) === 1);
  log(
    "基本給の行に雇用形態と業務内容が表示される（アルバイト・基本業務）",
    (await baseWageRow.textContent()).includes("アルバイト") && (await baseWageRow.textContent()).includes("基本業務"),
  );
  const wageAmountSnapshotBefore = psql(`select "wageAmountSnapshot" from "StaffContract" where id='${staffContractId}';`);

  // 改定は翌日から有効、にして日付解決（過去日は旧単価のまま／改定日以降は新単価）を検証する
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  await baseWageRow.getByRole("button", { name: "改定" }).click();
  await admin.waitForTimeout(150);
  const wagePopup = admin.locator("div.fixed.inset-0.z-40").last();
  const wageInput = wagePopup.locator('input[type=number]');
  await wageInput.fill("1200");
  await wagePopup.locator('input[type=date]').fill(tomorrow);
  await wagePopup.getByRole("button", { name: "保存" }).click();
  await admin.waitForTimeout(500);

  const wageAfter = psql(`select "wageAmountSnapshot" from "StaffContract" where id='${staffContractId}';`);
  log("wageAmountSnapshot（同意時点の金額）は改定後も変わらない", wageAfter === wageAmountSnapshotBefore);

  const newVersionCount = psql(
    `select count(*) from "StaffContractWageVersion" where "staffContractId"='${staffContractId}' and "wageAmount"=1200 and "effectiveFrom"='${tomorrow}';`,
  );
  log("StaffContractWageVersionに新しいバージョンが上書きせず追加される", newVersionCount === "1");

  const contractStatusAfter = psql(`select status from "StaffContract" where id='${staffContractId}';`);
  log("契約ステータスはACTIVEのまま（再同意を求めない）", contractStatusAfter === "ACTIVE");

  const noticeCount = psql(
    `select count(*) from "StaffNotice" where "staffUserId"='${staffUserId}' and message like '%基本給%1200円%';`,
  );
  log("基本給改定のお知らせが作成される", noticeCount === "1");

  await staff.goto("http://localhost:3000/staff");
  await staff.waitForTimeout(500);
  const staffBody = await staff.textContent("body");
  log("スタッフ画面のお知らせに基本給改定が表示される", staffBody.includes("基本給") && staffBody.includes("1200円"));

  await admin.goto("http://localhost:3000/company/roster");
  await admin.locator("tbody tr", { hasText: "自社確認花子" }).click();
  await admin.waitForTimeout(300);
  const panelHistory = admin.locator("div.fixed.inset-0.z-30").last();
  await panelHistory.getByRole("button", { name: "業務内容単価" }).click();
  const baseWageRowAfter = panelHistory.locator("li", { hasText: "基本給" });
  await baseWageRowAfter.getByRole("button", { name: /履歴/ }).click();
  await admin.waitForTimeout(150);
  const historyText = await baseWageRowAfter.textContent();
  log(
    "基本給の履歴に旧単価（1000円）と新単価（1200円）の両方が表示される",
    historyText.includes("1000円") && historyText.includes("1200円"),
  );

  // shift with no task-rate override, dated TODAY (before the revision's effective date=tomorrow)
  // -> payroll must still use the OLD base wage (改定前の過去分を再計算しても変わらない)
  const plainShiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'INHOUSE', null, current_date, '09:00', '13:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt")` +
      ` values (gen_random_uuid()::text, '${plainShiftId}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '4 hours', now(), 240, now(), now());`,
  );

  // shift dated TOMORROW (on/after the revision's effective date) -> must use the NEW base wage
  const futureShiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'INHOUSE', null, current_date + 1, '09:00', '13:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt")` +
      ` values (gen_random_uuid()::text, '${futureShiftId}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '4 hours', now(), 240, now(), now());`,
  );

  const todayMonth = new Date().toISOString().slice(0, 7);
  const tomorrowMonth = tomorrow.slice(0, 7);
  await admin.goto(`http://localhost:3000/company/payroll?month=${todayMonth}&staff=${staffUserId}`);
  await admin.waitForTimeout(600);
  if (tomorrowMonth !== todayMonth) {
    await admin.goto(`http://localhost:3000/company/payroll?month=${tomorrowMonth}&staff=${staffUserId}`);
    await admin.waitForTimeout(600);
  }

  const rawLineBefore = psql(
    `select json_agg(json_build_object('rate', rate, 'amount', amount))->0 from "SalarySlipLine" ssl join "SalarySlip" ss on ss.id=ssl."salarySlipId" where ss."staffUserId"='${staffUserId}' and ssl."shiftId"='${plainShiftId}';`,
  );
  const lineBefore = rawLineBefore ? JSON.parse(rawLineBefore) : null;
  log(
    "改定日より前のシフトは旧基本給（時給1000円）のまま給与計算される",
    lineBefore && Number(lineBefore.rate) === 1000 && Number(lineBefore.amount) === 4000,
  );

  const rawLineAfter = psql(
    `select json_agg(json_build_object('rate', rate, 'amount', amount))->0 from "SalarySlipLine" ssl join "SalarySlip" ss on ss.id=ssl."salarySlipId" where ss."staffUserId"='${staffUserId}' and ssl."shiftId"='${futureShiftId}';`,
  );
  const lineAfter = rawLineAfter ? JSON.parse(rawLineAfter) : null;
  log(
    "改定日以降のシフトは新基本給（時給1200円）で給与計算される",
    lineAfter && Number(lineAfter.rate) === 1200 && Number(lineAfter.amount) === 4800,
  );

  // --- 月給は月初（1日）からのみ改定可能（他契約の影響を避けるため別スタッフで検証）
  const staffEmail2 = `inhousetask-staff2-${Date.now()}@example.com`;
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl2 = await admin.locator("input[readonly]").inputValue();
  await staff2.goto(inviteUrl2);
  await staff2.click("text=アカウントを作成して参加する");
  await staff2.fill("#name", "月給確認次郎");
  await staff2.fill("#email", staffEmail2);
  await staff2.fill("#password", "password123");
  await staff2.click("button[type=submit]");
  await staff2.waitForURL(new RegExp("/invite/"));
  await staff2.click("text=参加する");
  await staff2.waitForURL("http://localhost:3000/staff");
  const staffUserId2 = psql(`select id from "User" where email='${staffEmail2}';`);

  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("月給業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("MONTHLY");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("250000");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);

  // スタッフの自由選択は廃止済み — 直接ACTIVEな契約として投入する
  const monthlyTemplateId = psql(`select id from "ContractTemplate" where "companyId"='${companyId}' order by "createdAt" desc limit 1;`);
  const monthlyWageAmount = psql(`select "wageAmount" from "ContractTemplate" where id='${monthlyTemplateId}';`);
  const seededMonthlyContractId = psql(
    `with ins as (insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", "contractStartDate", status, "consentedAt", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${monthlyTemplateId}', '${staffUserId2}', ${monthlyWageAmount}, current_date - interval '7 day', 'ACTIVE', now(), now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "StaffContractWageVersion" (id, "staffContractId", "wageAmount", "effectiveFrom", "createdAt") ` +
      `values (gen_random_uuid()::text, '${seededMonthlyContractId}', ${monthlyWageAmount}, current_date - interval '7 day', now());`,
  );
  psql(`update "ContractTemplate" set status='LOCKED' where id='${monthlyTemplateId}';`);
  const monthlyContractId = psql(
    `select sc.id from "StaffContract" sc where sc."staffUserId"='${staffUserId2}' and sc.status='ACTIVE' order by sc."createdAt" desc limit 1;`,
  );

  await admin.goto("http://localhost:3000/company/roster");
  await admin.locator("tbody tr", { hasText: "月給確認次郎" }).click();
  await admin.waitForTimeout(300);
  const panel2 = admin.locator("div.fixed.inset-0.z-30").last();
  await panel2.getByRole("button", { name: "業務内容単価" }).click();
  const monthlyBaseWageRow = panel2.locator("li", { hasText: "基本給" });
  log("月給契約でも基本給の行が業務内容単価タブに表示される", (await monthlyBaseWageRow.count()) === 1);

  const midMonth = new Date();
  midMonth.setUTCDate(15);
  const midMonthStr = midMonth.toISOString().slice(0, 10);

  await monthlyBaseWageRow.getByRole("button", { name: "改定" }).click();
  await admin.waitForTimeout(150);
  const monthlyPopup = admin.locator("div.fixed.inset-0.z-40").last();
  await monthlyPopup.locator('input[type=number]').fill("260000");
  await monthlyPopup.locator('input[type=date]').fill(midMonthStr);
  await monthlyPopup.getByRole("button", { name: "保存" }).click();
  await admin.waitForTimeout(500);
  const rejectedText = await monthlyPopup.textContent();
  log("月給を月中の日付で改定しようとするとエラーになる", rejectedText.includes("月初（1日）"));

  const monthlyVersionRejectedCount = psql(
    `select count(*) from "StaffContractWageVersion" where "staffContractId"='${monthlyContractId}' and "wageAmount"=260000;`,
  );
  log("月中改定は実際にはバージョンが追加されない", monthlyVersionRejectedCount === "0");

  const nextMonthStart = new Date(Date.UTC(midMonth.getUTCFullYear(), midMonth.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);
  await monthlyPopup.locator('input[type=date]').fill(nextMonthStart);
  await monthlyPopup.getByRole("button", { name: "保存" }).click();
  await admin.waitForTimeout(500);

  const monthlyVersionAcceptedCount = psql(
    `select count(*) from "StaffContractWageVersion" where "staffContractId"='${monthlyContractId}' and "wageAmount"=260000 and "effectiveFrom"='${nextMonthStart}';`,
  );
  log("月初（1日）の改定は成功しバージョンが追加される", monthlyVersionAcceptedCount === "1");

  console.log(
    process.exitCode
      ? "INHOUSE TASK / WAGE REVISION SMOKE TEST HAD FAILURES"
      : "INHOUSE TASK / WAGE REVISION SMOKE TEST PASSED",
  );
} catch (err) {
  console.error("INHOUSE TASK / WAGE REVISION SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-inhouse-task-wage-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-inhouse-task-wage-staff-failure.png" });
  await staff2.screenshot({ path: "/tmp/smoke-inhouse-task-wage-staff2-failure.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
