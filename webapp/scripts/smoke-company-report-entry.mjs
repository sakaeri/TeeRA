import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// スタッフが出していない業務報告を、会社が代わりに入力する（入力と同時に承認済み）：
// ・業務報告の詳細の「会社が代わりに入力する」（時刻はシフトの予定時刻が入っている）
// ・スタッフ詳細の「未提出の勤務をまとめて入力」
// ・スタッフ詳細の「過去の勤務を追加」（シフトが無い日）
// ・本アカウントのスタッフにはお知らせが届く／経緯に「会社が入力」と出る

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
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const suffix = Date.now();
const companyName = `代わりに入力確認株式会社${suffix}`;
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "代理入力管理者");
  await page.fill("#email", `entry-admin-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  const staffId = psql(
    `with ins as (insert into "User" (id, email, name, "createdAt", "updatedAt") values (gen_random_uuid()::text, 'entry-staff-${suffix}@example.com', '代理入力スタッフ', now(), now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role, "createdAt") values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF', now());`);
  const newShift = (start, end) =>
    psql(
      `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", "createdVia", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'INHOUSE', '${today}', '${start}', '${end}', 'ASSIGN', now()) returning id) select id from ins;`,
    );
  const shiftA = newShift("09:00", "17:00");
  // 勤務先：配属されている「配属ゴルフ場」と、配属されていない「ほかのゴルフ場」
  const newRel = (name) =>
    psql(
      `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") values (gen_random_uuid()::text, '${companyId}', '${companyId}', '${name}', 'ACTIVE', now()) returning id) select id from ins;`,
    );
  newRel("あいうえおゴルフ場");
  const placedRel = newRel("配属ゴルフ場");
  psql(`insert into "StaffPlacement" (id, "staffUserId", "companyRelationshipId", active, "createdAt") values (gen_random_uuid()::text, '${staffId}', '${placedRel}', true, now());`);

  // --- 業務報告の詳細から代わりに入力 ---
  await page.goto("http://localhost:3000/company/roster");
  await page.locator("tbody tr", { hasText: "代理入力スタッフ" }).click();
  const panel = page.locator("div.fixed.inset-0.z-30").last();
  await panel.locator("li button", { hasText: "自社" }).first().click();
  const dialog = page.getByRole("dialog", { name: "業務報告の詳細" });
  await dialog.getByTestId("company-enter-report").click();
  const form = dialog.getByTestId("company-entry-form");
  await form.waitFor();
  log("時刻はシフトの予定時刻が入っている", (await form.locator('input[type="time"]').first().inputValue()) === "09:00" && (await form.locator('input[type="time"]').nth(1).inputValue()) === "17:00");
  await form.locator('input[type="number"]').fill("60");
  await form.getByRole("button", { name: "入力して承認済みにする" }).click();
  await dialog.getByTestId("report-action-done").waitFor({ timeout: 15000 });
  const rowA = psql(`select "approvalStatus"||'|'||"computedMinutes"||'|'||("enteredByCompanyUserId" is not null) from "WorkReport" where "shiftId"='${shiftA}';`);
  log("入力するとそのまま承認済みになる（8時間−休憩60分＝420分）", rowA === "APPROVED|420|true");
  log("経緯に「会社が入力」と出る", (await dialog.innerText()).includes("会社が入力"));
  log("本アカウントのスタッフにお知らせが届く", psql(`select count(*) from "StaffNotice" where "staffUserId"='${staffId}' and message like '%業務報告を会社が入力しました%';`) === "1");
  await dialog.getByRole("button", { name: "閉じる" }).click();

  // --- 未提出の勤務をまとめて入力 ---
  const shiftB = newShift("08:00", "12:00");
  const shiftC = newShift("13:00", "18:00");
  await page.goto("http://localhost:3000/company/roster");
  await page.locator("tbody tr", { hasText: "代理入力スタッフ" }).click();
  const panel2 = page.locator("div.fixed.inset-0.z-30").last();
  await panel2.getByTestId("open-bulk-entry").click();
  const bulk = page.getByTestId("bulk-entry-modal");
  await bulk.waitFor();
  log("未提出の勤務（2件）が並ぶ", (await bulk.getByTestId("bulk-entry-row").count()) === 2);
  await bulk.getByRole("button", { name: /件を入力して承認済みにする/ }).click();
  await bulk.getByTestId("bulk-entry-result").waitFor({ timeout: 15000 });
  log("まとめて入力すると2件とも承認済みになる", psql(`select count(*) from "WorkReport" where "shiftId" in ('${shiftB}','${shiftC}') and "approvalStatus"='APPROVED';`) === "2");
  await bulk.getByRole("button", { name: "閉じる" }).click();

  // --- 過去の勤務を追加（シフトが無い日） ---
  await panel2.getByTestId("open-past-work").click();
  const past = page.getByTestId("past-work-modal");
  await past.waitFor();
  await past.getByTestId("past-work-workplace").waitFor();
  const firstOption = await past.getByTestId("past-work-workplace").locator("option").first().innerText();
  log("勤務先は配属されているものが一番上に並び、最初から選ばれている", firstOption === "配属ゴルフ場" && (await past.getByTestId("past-work-workplace").inputValue()) === placedRel);
  // 日付はカレンダーで複数選べる（今日と、同じ月なら昨日）
  const yesterday = new Date(Date.now() + 9 * 3600e3 - 24 * 3600e3).toISOString().slice(0, 10);
  const picks = yesterday.slice(0, 7) === today.slice(0, 7) ? [yesterday, today] : [today];
  for (const d of picks) await past.getByTestId("past-dates-picker").locator(`button[data-date="${d}"]`).click();
  await past.locator('input[type="time"]').first().fill("19:00");
  await past.locator('input[type="time"]').nth(1).fill("21:30");
  await past.getByRole("button", { name: /追加して承認済みにする/ }).click();
  await past.getByTestId("past-work-message").waitFor({ timeout: 20000 });
  log(
    `過去の勤務を追加すると、選んだ日（${picks.length}日）ぶんシフトと承認済みの業務報告ができる（150分）`,
    psql(`select count(*) from "Shift" s join "WorkReport" w on w."shiftId"=s.id where s."staffUserId"='${staffId}' and s."startTime"='19:00' and w."approvalStatus"='APPROVED' and w."computedMinutes"=150;`) === String(picks.length),
  );

  // --- これからの日は選べない ---
  const tomorrow = new Date(Date.now() + 33 * 3600e3).toISOString().slice(0, 10);
  const tomorrowButton = past.getByTestId("past-dates-picker").locator(`button[data-date="${tomorrow}"]`);
  log("これからの日はカレンダーで選べない", (await tomorrowButton.count()) === 0 || (await tomorrowButton.isDisabled()));

  console.log(process.exitCode ? "COMPANY REPORT ENTRY SMOKE TEST HAD FAILURES" : "COMPANY REPORT ENTRY SMOKE TEST PASSED");
} catch (e) {
  console.error("COMPANY REPORT ENTRY SMOKE TEST FAILED", e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
