import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 月表示のスタッフ名の枠：出勤時間が未定のシフトは濃い緑（一番目立つ）、
// 時間が入ったものは白地に緑の枠。日付を押した詳細では未定の人に「未定」と出る。

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`)
    .toString()
    .trim()
    .split("\n")[0];
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext()).newPage();
const suffix = Date.now();
const companyName = `未定確認株式会社${suffix}`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "未定本部");
  await page.fill("#email", `undecided-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  const staffId = (name) =>
    psql(
      `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'undecided-${name}-${suffix}@example.com', 'x', '${name}', now()) returning id) select id from ins;`,
    );
  // 明日のシフト（未定と時間あり）
  const day = psql(`select ((now() at time zone 'Asia/Tokyo')::date + 1)::text;`);
  const [y, m, d] = day.split("-").map(Number);
  const shift = (userId, undecided) =>
    psql(
      `insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
        `values (gen_random_uuid()::text, '${companyId}', '${userId}', 'INHOUSE', '確認', '${day}', ${undecided ? "null, null" : "'09:00', '17:00'"}, false, ${undecided}, 'CONFIRMED', 'ASSIGN', now(), now());`,
    );
  shift(staffId("未定スタッフ"), true);
  shift(staffId("時間ありスタッフ"), false);

  await page.goto(`http://localhost:3000/company/calendar?y=${y}&m=${m}`);
  await page.waitForTimeout(800);
  const cell = page.locator(`button:has(> span:text-is("${d}"))`).first();
  const undecidedClass = await cell.locator("span.rounded", { hasText: "未定スタッフ" }).first().getAttribute("class");
  const timedClass = await cell.locator("span.rounded", { hasText: "時間ありスタッフ" }).first().getAttribute("class");
  log("出勤時間が未定のシフトは濃い緑", (undecidedClass ?? "").includes("bg-emerald-700"));
  log("時間が入ったシフトは白地に緑の枠", (timedClass ?? "").includes("bg-white") && (timedClass ?? "").includes("ring-emerald-500"));

  await cell.click();
  await page.waitForTimeout(500);
  const detail = await page.locator("div.fixed.inset-0").last().innerText();
  log("日付の詳細では未定の人に「未定」と出る", detail.includes("未定"));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(process.exitCode ? "CALENDAR UNDECIDED SMOKE TEST FAILED" : "CALENDAR UNDECIDED SMOKE TEST PASSED");
