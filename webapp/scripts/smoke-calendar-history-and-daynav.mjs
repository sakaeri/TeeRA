import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

// 2つの不具合を検証する：
// ①日別詳細の「変更履歴」が、同じ会社・同じ業務内容の枠変更/キャンセル
//   だと「別の枠に変更」「キャンセル済み」としか出ず、何がどう変わった
//   のか一切分からなかった（変更前のシフトの時間・業務内容を常に表示
//   するよう修正）
// ②日別詳細モーダルの＜＞で月をまたいで日付移動すると、実際にはシフトが
//   あってもその月のデータをまだ取得していないため「この日のシフトは
//   ありません」と誤表示されていた（月をまたぐ場合はページ遷移して
//   データを取得し直すよう修正）
//
// 日付は実行時点の「今日」基準で動的に計算する（ハードコードすると、
// 過去日になって解除ボタンが出せなくなったり、月末付近で意図せず月境界の
// テストになったりするため）。

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(
    `PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`,
  )
    .toString()
    .split("\n")
    .filter((line) => !/^(INSERT|UPDATE|DELETE)\s/.test(line))
    .join("\n")
    .trim();
}
function ymd(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { y, m, d };
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const suffix = Date.now();
const adminEmail = `calhist-admin-${suffix}@example.com`;
const companyName = `変更履歴確認株式会社${suffix}`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "変更履歴確認管理者");
  await page.fill("#email", adminEmail);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  const staffId = psql(
    `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'calhist-staff-${suffix}@example.com', 'x', '変更履歴確認スタッフ', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);

  // --- ①同じ会社・同じ業務のシフトをキャンセルしても、変更履歴に時間・
  //     業務内容が常に表示されるか（対象日は解除ボタンが出るよう明日にする）---
  const targetDateStr = psql(`select ((now() at time zone 'Asia/Tokyo')::date + 1)::text;`);
  const target = ymd(targetDateStr);
  const shiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", "taskName", status, "createdVia", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'INHOUSE', '${targetDateStr}', '09:00', '18:00', '通常業務', 'CONFIRMED', 'ASSIGN', now()) returning id) select id from ins;`,
  );

  await page.goto(`http://localhost:3000/company/calendar?y=${target.y}&m=${target.m}`);
  await page.waitForTimeout(500);
  await page.locator(`button:has-text("${target.d}")`).first().click();
  await page.waitForTimeout(300);
  const dayModal = page.locator("div.fixed.inset-0.z-20").last();
  await dayModal.getByRole("button", { name: "シフトを解除" }).click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "解除する" }).click();
  await page.waitForTimeout(500);

  const statusAfterCancel = psql(`select status from "Shift" where id='${shiftId}';`);
  log("シフトがCANCELLEDになる", statusAfterCancel === "CANCELLED");

  // 解除確認ダイアログを閉じただけでは日別詳細モーダル自体は開いたままな
  // ので、それを使って変更履歴を確認する（キャンセルするとrevalidatePath
  // でシフト一覧・履歴とも最新化される）。
  await dayModal.getByRole("button", { name: /変更履歴/ }).click();
  await page.waitForTimeout(200);
  const historyText = await dayModal.locator("ul").last().innerText();
  log(
    "同じ会社・同じ業務でも、変更前の時間・業務内容が変更履歴に表示される",
    historyText.includes("09:00〜18:00") && historyText.includes("通常業務"),
  );
  log("変更履歴にキャンセル済みも表示される", historyText.includes("キャンセル済み"));
  await dayModal.getByRole("button", { name: "✕", exact: true }).click();
  await page.waitForTimeout(200);

  // --- ②日別詳細モーダルの＞で月をまたぐと、翌月の実データが表示されるか ---
  // 今月末日を開いて「＞」を押すと翌月1日に移動する。翌月1日には別スタッフ
  // のシフトをあらかじめ用意しておく。
  const lastDayOfMonthStr = psql(
    `select (date_trunc('month', (now() at time zone 'Asia/Tokyo')::date) + interval '1 month' - interval '1 day')::date::text;`,
  );
  const nextDayStr = psql(`select ('${lastDayOfMonthStr}'::date + 1)::text;`);
  const lastDay = ymd(lastDayOfMonthStr);
  const nextDay = ymd(nextDayStr);

  const nextMonthStaffId = psql(
    `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'calhist-nextmonth-${suffix}@example.com', 'x', '翌月確認スタッフ', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${nextMonthStaffId}', '${companyId}', 'STAFF');`);
  psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", "taskName", status, "createdVia", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${nextMonthStaffId}', 'INHOUSE', '${nextDayStr}', '10:00', '19:00', '翌月業務', 'CONFIRMED', 'ASSIGN', now());`,
  );

  await page.goto(`http://localhost:3000/company/calendar?y=${lastDay.y}&m=${lastDay.m}`);
  await page.waitForTimeout(500);
  await page.locator(`button:has-text("${lastDay.d}")`).first().click();
  await page.waitForTimeout(300);
  let navModal = page.locator("div.fixed.inset-0.z-20").last();
  await navModal.getByRole("button", { name: "次の日" }).click();
  await page.waitForTimeout(800);

  navModal = page.locator("div.fixed.inset-0.z-20").last();
  const crossMonthBody = await navModal.innerText();
  log("月をまたいだ日付ラベルが翌月1日になる", crossMonthBody.includes(`${nextDay.m}月${nextDay.d}日`));
  log(
    "月またぎ後、実際にある翌月のシフトが表示される（「シフトはありません」にならない）",
    crossMonthBody.includes("翌月業務") && !crossMonthBody.includes("この日のシフトはありません"),
  );
  log("URLの年月も翌月に更新される（該当月のデータを取得し直している）", page.url().includes(`m=${nextDay.m}`));

  console.log(process.exitCode ? "CALENDAR HISTORY/DAYNAV SMOKE TEST HAD FAILURES" : "CALENDAR HISTORY/DAYNAV SMOKE TEST PASSED");
} catch (err) {
  console.error("CALENDAR HISTORY/DAYNAV SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
