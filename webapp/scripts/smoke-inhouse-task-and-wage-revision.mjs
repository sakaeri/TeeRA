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
  await staff.goto("http://localhost:3000/staff/contracts");
  await staff.getByRole("button", { name: "契約を結ぶ" }).click();
  await staff.waitForTimeout(600);
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
  await admin.goto("http://localhost:3000/company/roster");
  await admin.locator("tbody tr", { hasText: "自社確認花子" }).click();
  await admin.waitForTimeout(300);
  const panel = admin.locator("div.fixed.inset-0.z-30").last();
  await panel.getByRole("button", { name: "契約書管理" }).click();
  await panel.getByRole("button", { name: "基本給を改定" }).click();
  await admin.waitForTimeout(150);
  const wageInput = admin.locator("div.fixed.inset-0.z-40").last().locator('input[type=number]');
  await wageInput.fill("1200");
  await admin.locator("div.fixed.inset-0.z-40").last().getByRole("button", { name: "保存" }).click();
  await admin.waitForTimeout(500);

  const wageAfter = psql(`select "wageAmountSnapshot" from "StaffContract" where id='${staffContractId}';`);
  log("同じ契約行のwageAmountSnapshotが上書きされる（結び直しなし）", wageAfter === "1200");

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

  // shift with no task-rate override -> payroll should now use the REVISED base wage (1200)
  const plainShiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'INHOUSE', null, current_date, '09:00', '13:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt")` +
      ` values (gen_random_uuid()::text, '${plainShiftId}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '4 hours', now(), 240, now(), now());`,
  );
  const thisMonth = new Date().toISOString().slice(0, 7);
  await admin.goto(`http://localhost:3000/company/payroll?month=${thisMonth}&staff=${staffUserId}`);
  await admin.waitForTimeout(600);
  const rawLine = psql(
    `select json_agg(json_build_object('rate', rate, 'amount', amount))->0 from "SalarySlipLine" ssl join "SalarySlip" ss on ss.id=ssl."salarySlipId" where ss."staffUserId"='${staffUserId}' and ssl."shiftId"='${plainShiftId}';`,
  );
  const line = rawLine ? JSON.parse(rawLine) : null;
  log("改定後の基本給（時給1200円）が給与計算に反映される", line && Number(line.rate) === 1200 && Number(line.amount) === 4800);

  console.log(
    process.exitCode
      ? "INHOUSE TASK / WAGE REVISION SMOKE TEST HAD FAILURES"
      : "INHOUSE TASK / WAGE REVISION SMOKE TEST PASSED",
  );
} catch (err) {
  console.error("INHOUSE TASK / WAGE REVISION SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-inhouse-task-wage-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-inhouse-task-wage-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
