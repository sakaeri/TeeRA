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

const adminEmail = `koyama-admin-${Date.now()}@example.com`;
const staffEmail = `koyama-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "古山検証管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "古山検証株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='古山検証株式会社' order by "createdAt" desc limit 1;`);

  // two clients: A社, B社
  for (const name of ["A社", "B社"]) {
    await admin.goto("http://localhost:3000/company/roster");
    await admin.click("text=依頼主一覧");
    await admin.waitForTimeout(200);
    await admin.click("text=＋依頼主を追加する");
    await admin.waitForTimeout(200);
    await admin.click("text=仮アカウントを作成");
    await admin.fill('input[placeholder="名称を入力"]', name);
    await admin.getByRole("button", { name: "作成", exact: true }).click();
    await admin.waitForTimeout(600);
  }
  const relAId = psql(`select cr.id from "CompanyRelationship" cr join "Company" c on c."id"=cr."ownerCompanyId" where c.id='${companyId}' and cr."proxyName"='A社';`);
  const relBId = psql(`select cr.id from "CompanyRelationship" cr join "Company" c on c."id"=cr."ownerCompanyId" where c.id='${companyId}' and cr."proxyName"='B社';`);
  log("A社・B社の取引先を作成", Boolean(relAId) && Boolean(relBId) && relAId !== relBId);

  // invite + register staff (古山さん)
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "古山");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // base HOURLY 1000円 contract (fallback baseline, should never be hit for these 3 tasks)
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

  // set: キャディ業務×A社=11000円/日, キャディ業務×B社=12000円/日, 作業×勤務先問わず=8000円/日
  await admin.goto("http://localhost:3000/company/roster");
  await admin.locator("tbody tr", { hasText: "古山" }).click();
  await admin.waitForTimeout(300);
  const panel = admin.locator("div.fixed.inset-0.z-30").last();
  await panel.getByRole("button", { name: "業務内容単価" }).click();

  // 業務内容の入力欄は、既に登録済みの業務名がある会社では選択式（既存の名前を
  // 選ぶ or ＋新しい業務内容を追加する）に切り替わる。まだ無ければ通常のテキスト
  // 入力のまま。
  async function fillTaskName(name) {
    const input = panel.locator('input[placeholder*="業務内容"]');
    if ((await input.count()) === 0) {
      const picker = panel.locator("select").first();
      const hasOption = (await picker.locator("option", { hasText: name }).count()) > 0;
      if (hasOption) {
        await picker.selectOption({ label: name });
        return;
      }
      await picker.selectOption({ label: "＋ 新しい業務内容を追加する" });
    }
    await panel.locator('input[placeholder*="業務内容"]').fill(name);
  }

  async function addRate(taskName, workplace, amount) {
    await panel.getByRole("button", { name: "＋業務内容を追加" }).click();
    await admin.waitForTimeout(150);
    await fillTaskName(taskName);
    if (workplace) {
      await panel.getByLabel("勤務先").selectOption({ label: workplace });
    }
    await panel.locator("select").last().selectOption("DAILY");
    await panel.locator('input[placeholder="金額"]').fill(String(amount));
    await panel.getByRole("button", { name: "追加", exact: true }).click();
    await admin.waitForTimeout(400);
  }

  await addRate("キャディ業務", "A社", 11000);
  await addRate("キャディ業務", "B社", 12000);
  await addRate("作業", null, 8000);

  const rateCount = psql(`select count(*) from "StaffTaskRate" where "staffUserId"='${staffUserId}';`);
  log("3件の業務内容単価が登録された（キャディ業務×2 + 作業×1）", rateCount === "3");

  let panelText = await panel.textContent();
  log("キャディ業務がA社・B社それぞれ表示される", panelText.includes("A社") && panelText.includes("B社"));
  log("作業は「勤務先問わず」と表示される", panelText.includes("作業") && panelText.includes("勤務先問わず"));
  await panel.click("text=閉じる");
  await admin.waitForTimeout(200);

  // shift #1: キャディ業務 at A社 -> 11000円 (flat, DAILY)
  const shiftA = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'CLIENT', '${relAId}', 'キャディ業務', current_date, '09:00', '17:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(`insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${shiftA}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '8 hours', now(), 480, now(), now());`);

  // shift #2: キャディ業務 at B社 -> 12000円
  const shiftB = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'CLIENT', '${relBId}', 'キャディ業務', current_date, '09:00', '17:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(`insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${shiftB}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '8 hours', now(), 480, now(), now());`);

  // shift #3: 作業 at A社 (no A社-specific 作業 rate -> falls back to the 勤務先問わず 8000円 entry)
  const shiftC = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'CLIENT', '${relAId}', '作業', current_date, '09:00', '17:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(`insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${shiftC}', '${staffUserId}', 'WORKED', 'APPROVED', now() - interval '8 hours', now(), 480, now(), now());`);

  const thisMonth = new Date().toISOString().slice(0, 7);
  await admin.goto(`http://localhost:3000/company/payroll?month=${thisMonth}&staff=${staffUserId}`);
  await admin.waitForTimeout(500);

  const lines = JSON.parse(
    psql(`select json_agg(json_build_object('shiftId', ssl."shiftId", 'rate', rate, 'amount', amount)) from "SalarySlipLine" ssl join "SalarySlip" ss on ss.id=ssl."salarySlipId" where ss."staffUserId"='${staffUserId}';`),
  ) ?? [];
  const lineA = lines.find((l) => l.shiftId === shiftA);
  const lineB = lines.find((l) => l.shiftId === shiftB);
  const lineC = lines.find((l) => l.shiftId === shiftC);

  log("キャディ業務@A社 = 11,000円", lineA && Number(lineA.rate) === 11000 && Number(lineA.amount) === 11000);
  log("キャディ業務@B社 = 12,000円（同じ業務内容名でも勤務先で単価が異なる）", lineB && Number(lineB.rate) === 12000 && Number(lineB.amount) === 12000);
  log("作業@A社 = 8,000円（勤務先問わずの単価にフォールバック、A社専用の作業単価は無い）", lineC && Number(lineC.rate) === 8000 && Number(lineC.amount) === 8000);

  // --- notices ---
  const noticeCount = psql(`select count(*) from "StaffNotice" where "staffUserId"='${staffUserId}';`);
  log("単価登録のたびにお知らせが3件作成された", noticeCount === "3");

  await staff.goto("http://localhost:3000/staff");
  await staff.waitForTimeout(500);
  let staffBody = await staff.textContent("body");
  log("スタッフ画面トップに「お知らせ」欄が表示される", staffBody.includes("お知らせ"));
  log("お知らせにキャディ業務(A社)の内容が含まれる", staffBody.includes("キャディ業務") && staffBody.includes("A社") && staffBody.includes("11000円"));

  // dismiss one notice
  const firstDismiss = staff.getByRole("button", { name: "既読にする" }).first();
  await firstDismiss.click();
  await staff.waitForTimeout(500);
  const unreadAfterDismiss = psql(`select count(*) from "StaffNotice" where "staffUserId"='${staffUserId}' and "readAt" is null;`);
  log("✕で既読にすると未読件数が減る（DB上もreadAtが記録される）", unreadAfterDismiss === "2");

  console.log(process.exitCode ? "STAFF WORKPLACE RATE / NOTICES SMOKE TEST HAD FAILURES" : "STAFF WORKPLACE RATE / NOTICES SMOKE TEST PASSED");
} catch (err) {
  console.error("STAFF WORKPLACE RATE / NOTICES SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-staff-workplace-rate-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-staff-workplace-rate-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
