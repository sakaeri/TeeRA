import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// カレンダーの週の始まり（日曜／月曜）を、アカウント設定で人ごとに選べる。
// 選ぶと、シフトカレンダー・ダッシュボードの申請カレンダー・シフト作成の日付選択が月曜始まりになる

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
// 2026年12月1日は火曜日
const headerOf = async (root) => (await root.locator("div.grid.grid-cols-7").first().innerText()).replace(/\s+/g, "");
try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "担当者");
  await page.fill("#email", `wstart-${s}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", `週始${s}`);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='週始${s}';`);
  const staffId = psql(`insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'wstart-st-${s}@example.com', 'x', '田中', now()) returning id;`);
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);
  psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'WORK', ARRAY['2026-12-07']::date[], 'PENDING');`);

  await page.goto("http://localhost:3000/company/calendar?y=2026&m=12");
  await page.waitForTimeout(2500);
  log("最初は日曜始まり", (await headerOf(page)) === "日月火水木金土");

  await page.goto("http://localhost:3000/account");
  await page.getByTestId("week-start-setting").getByRole("button", { name: "月曜始まり" }).click();
  await page.getByText("保存しました。").waitFor();
  log("設定が保存される", psql(`select "weekStartsMonday" from "User" where email='wstart-${s}@example.com';`) === "t");
  await page.screenshot({ path: "/tmp/wstart-account.png" });

  await page.goto("http://localhost:3000/company/calendar?y=2026&m=12");
  await page.waitForTimeout(2500);
  log("シフトカレンダーが月曜始まりになる", (await headerOf(page)) === "月火水木金土日");
  // 12月1日（火）は2マス目（前に空きが1つ）
  const firstRow = page.locator("div.grid.grid-cols-7").nth(1);
  const blanksBefore1 = await firstRow.evaluate((grid) => {
    const kids = [...grid.children];
    return kids.findIndex((k) => k.textContent?.trim().startsWith("1"));
  });
  log("12月1日（火）は月曜始まりで2マス目", blanksBefore1 === 1);
  await page.screenshot({ path: "/tmp/wstart-calendar.png" });

  await page.goto("http://localhost:3000/company?open=unconfirmed");
  await page.waitForTimeout(2500);
  const reqCal = page.getByTestId("request-dates-calendar");
  log("ダッシュボードの申請カレンダーも月曜始まり", (await headerOf(reqCal)).startsWith("月火水木金土日"));
  await page.getByTestId("create-shift-from-request").click();
  await page.waitForURL(/\/company\/calendar/);
  const modal = page.locator("div.fixed.inset-0.z-20").last();
  await modal.getByRole("button", { name: /社内（自社スタッフとして勤務）/ }).click({ timeout: 60000 });
  await modal.getByRole("button", { name: "業務内容を選ばずに次へ" }).click();
  await modal.getByText("日付を選択（複数選択可）").waitFor();
  log("シフト作成の日付選択も月曜始まり", (await headerOf(modal)) === "月火水木金土日");
  const sel = await modal.locator("button[data-selected=true]").allInnerTexts();
  log("申請の日（7日・月曜）が選ばれている", JSON.stringify(sel.map((t) => t.trim())) === JSON.stringify(["7"]));

  console.log(process.exitCode ? "WEEK START SMOKE TEST HAD FAILURES" : "WEEK START SMOKE TEST PASSED");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "/tmp/wstart-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
