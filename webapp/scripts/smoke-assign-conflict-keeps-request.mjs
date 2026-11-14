import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// シフト希望の日を含めて複数の日でシフトを作り、1日だけ重なりがあって確認画面が出た時に、
// 閉じても（作らなくても）シフト希望が消えない・ほかの日のシフトも作られない。

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
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const s = Date.now();
try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "担当者");
  await page.fill("#email", `ackr-${s}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", `重複希望${s}`);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='重複希望${s}';`);
  const staffId = psql(`insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'ackr-st-${s}@example.com', 'x', '重複スタッフ', now()) returning id;`);
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);
  const ym = psql(`select to_char(date_trunc('month', (now() at time zone 'Asia/Tokyo')) + interval '1 month', 'YYYY-MM');`);
  const [d10, d12] = [`${ym}-10`, `${ym}-12`];
  const reqId = psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status, note) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'WORK', ARRAY['${d10}','${d12}']::date[], 'PENDING', '早番希望') returning id;`);
  // 12日にはもうシフトがある（重なる）
  psql(`insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", "createdVia", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'INHOUSE', '${d12}', '09:00', '18:00', 'ASSIGN', now());`);

  await page.goto(`http://localhost:3000/company/calendar?date=${d10}`);
  await page.waitForTimeout(2500);
  await page.locator("li", { hasText: "重複スタッフさん" }).getByRole("button", { name: "シフト作成" }).click();
  const modal = page.locator("div.fixed.inset-0.z-20").last();
  await modal.getByRole("button", { name: /社内（自社スタッフとして勤務）/ }).click();
  await modal.getByRole("button", { name: "業務内容を選ばずに次へ" }).click();
  await modal.getByText("日付を選択（複数選択可）").waitFor();
  await modal.getByRole("button", { name: "12", exact: true }).click();
  await modal.getByRole("button", { name: "次へ" }).click();
  await modal.getByText("内容を確認してください").waitFor();
  await modal.getByRole("button", { name: /件のシフトを作成|シフトを作成する|作成する/ }).last().click();
  await modal.getByText("他のシフトと重複している日があります。").waitFor();
  log("重なりがあると確認が出る", true);
  log("確認が出た時点では、ほかの日（10日）のシフトは作られていない", psql(`select count(*) from "Shift" where "staffUserId"='${staffId}' and date='${d10}';`) === "0");
  await page.locator("div.fixed.inset-0.z-20").last().getByRole("button", { name: "閉じる" }).first().click().catch(async () => {
    await page.keyboard.press("Escape");
  });
  await page.waitForTimeout(800);
  const req = psql(`select status||'|'||array_to_string(dates,',') from "ShiftRequest" where id='${reqId}';`);
  log("閉じてもシフト希望は消えない（まだ対応していないまま・2日とも残る）", req === `PENDING|${d10},${d12}`);
  log("シフト希望が別の行に分かれたりもしない", psql(`select count(*) from "ShiftRequest" where "staffUserId"='${staffId}';`) === "1");

  // 後始末の確認：対応したシフトが無いのに「対応済み」になっているシフト希望は、まだ対応していない状態に戻す
  const orphan = psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status, "matchedShiftId") values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'WORK', ARRAY['${ym}-15']::date[], 'MATCHED', 'no-such-shift-${s}') returning id;`);
  execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d teera -q -f prisma/migrations/20261114010000_restore_orphaned_matched_requests/migration.sql`);
  log("対応したシフトが無い「対応済み」のシフト希望は、まだ対応していない状態に戻る", psql(`select status from "ShiftRequest" where id='${orphan}';`) === "PENDING");

  console.log(process.exitCode ? "ASSIGN CONFLICT KEEPS REQUEST SMOKE TEST HAD FAILURES" : "ASSIGN CONFLICT KEEPS REQUEST SMOKE TEST PASSED");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "/tmp/ackr-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
