import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 勤務先：①解除画面の「別の勤務先に振り替える」②業務報告の確認に勤務先を表示し、「時間を直して確認してもらう」で勤務先も変える
// （以下、元の説明）
// ・カレンダーの上の「シフト希望」の欄はなくした（シフトはスタッフごとに作るので、日ごとの人数は不要）
// ・ダッシュボードの「未確定シフト」：スタッフの申請ごとに、申請した日を小さなカレンダーで示し、
//   「この申請でシフトを作る」で、その申請の日が全部選ばれた状態でシフト作成が開く

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
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
const s = Date.now();
try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "担当者");
  await page.fill("#email", `wpt-${s}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", `勤務先振替${s}`);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='勤務先振替${s}';`);
  const staff = (name) => {
    const id = psql(`insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'wpt-${name}-${s}@example.com', 'x', '${name}', now()) returning id;`);
    psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${id}', '${companyId}', 'STAFF');`);
    return id;
  };
  psql(`update "Company" set "agencyEnabled"=true where id='${companyId}';`);
  const relId = psql(`with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "clientCompanyId", "proxyName", status, "createdAt") values (gen_random_uuid()::text, '${companyId}', '${companyId}', null, 'Aゴルフ場', 'ACTIVE', now()) returning id) select id from ins;`);
  const staffId = staff("田中");
  const tomorrow = psql(`select to_char((now() at time zone 'Asia/Tokyo')::date + 1, 'YYYY-MM-DD');`);
  const yesterday = psql(`select to_char((now() at time zone 'Asia/Tokyo')::date - 1, 'YYYY-MM-DD');`);
  const oldShift = psql(`with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", status, "createdVia", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'INHOUSE', '${tomorrow}', '09:00', '18:00', 'CONFIRMED', 'ASSIGN', now()) returning id) select id from ins;`);

  // --- ① 解除画面から別の勤務先に振り替える ---
  await page.goto(`http://localhost:3000/company/calendar?date=${tomorrow}`);
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "シフトを解除" }).first().click();
  const modal = page.locator("div.fixed.inset-0.z-20").last();
  await modal.getByTestId("transfer-radio").check();
  await modal.getByTestId("transfer-to").selectOption({ label: "Aゴルフ場" });
  await page.screenshot({ path: "/tmp/wpt-transfer.png" });
  await modal.getByTestId("cancel-shift-confirm").click();
  await page.waitForTimeout(2000);
  log("元のシフトは解除される", psql(`select status from "Shift" where id='${oldShift}';`) === "CANCELLED");
  log("同じ日・同じ時間でAゴルフ場のシフトができる", psql(`select count(*) from "Shift" where "staffUserId"='${staffId}' and date='${tomorrow}' and status='CONFIRMED' and "companyRelationshipId"='${relId}' and "startTime"='09:00' and "endTime"='18:00';`) === "1");

  // --- ② 業務報告：勤務先の表示と、直して確認してもらうで勤務先を変える ---
  const pastShift = psql(`with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", status, "createdVia", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'INHOUSE', '${yesterday}', '09:00', '18:00', 'CONFIRMED', 'ASSIGN', now()) returning id) select id from ins;`);
  const reportId = psql(`with ins as (insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "clockIn", "clockOut", "breakMinutes", "computedMinutes", "approvalStatus", "submittedAt", "updatedAt") values (gen_random_uuid()::text, '${pastShift}', '${staffId}', 'WORKED', '${yesterday} 00:00', '${yesterday} 09:00', 60, 480, 'PENDING', now(), now()) returning id) select id from ins;`);
  await page.goto(`http://localhost:3000/company?open=reports&reportId=${reportId}`);
  await page.waitForTimeout(2500);
  log("業務報告の確認に「勤務先：社内」が出る", (await page.getByTestId("report-workplace").innerText()).includes("勤務先：社内"));
  await page.getByRole("button", { name: "時間を直して確認してもらう" }).click();
  await page.getByTestId("correction-workplace").selectOption({ label: "Aゴルフ場" });
  await page.screenshot({ path: "/tmp/wpt-correct.png" });
  await page.getByRole("button", { name: "保存してスタッフに確認してもらう" }).click();
  await page.waitForTimeout(2000);
  log("シフトの勤務先がAゴルフ場に変わる", psql(`select "companyRelationshipId" || ':' || source from "Shift" where id='${pastShift}';`) === `${relId}:CLIENT`);
  log("報告はスタッフの確認待ちになり、変更前の勤務先が残る", psql(`select "approvalStatus" || ':' || "workplaceChangedFrom" from "WorkReport" where id='${reportId}';`) === "NEEDS_CONFIRMATION:社内");

  console.log(process.exitCode ? "WORKPLACE TRANSFER SMOKE TEST HAD FAILURES" : "WORKPLACE TRANSFER SMOKE TEST PASSED");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "/tmp/wpt-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
