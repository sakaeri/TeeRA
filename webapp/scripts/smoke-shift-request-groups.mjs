import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// シフト希望：1回の申請で複数の日を出した人は、一覧（カレンダーの上）と日別の詳細で、
// 同じ申請の日に同じ色の印が付く。1日だけの申請は色なし。

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
  await page.fill("#email", `srg-${s}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", `希望色${s}`);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='希望色${s}';`);
  const staff = (name) => {
    const id = psql(`insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'srg-${name}-${s}@example.com', 'x', '${name}', now()) returning id;`);
    psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${id}', '${companyId}', 'STAFF');`);
    return id;
  };
  const tanaka = staff("田中まとめ");
  const sato = staff("佐藤ひとつ");
  // 同じ月の中の日付にする（今日から3・4・5日後。月をまたぐ場合はカレンダーの月を合わせて開く）
  const d = (n) => psql(`select to_char((now() at time zone 'Asia/Tokyo')::date + ${n}, 'YYYY-MM-DD');`);
  const [d3, d4, d5] = [d(3), d(4), d(5)];
  psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status) values (gen_random_uuid()::text, '${tanaka}', '${companyId}', 'WORK', ARRAY['${d3}','${d4}','${d5}']::date[], 'PENDING');`);
  psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status) values (gen_random_uuid()::text, '${sato}', '${companyId}', 'WORK', ARRAY['${d4}']::date[], 'PENDING');`);

  // 一覧はカレンダーの上（日付を指定しないで開く）
  await page.goto(`http://localhost:3000/company/calendar?y=${d4.slice(0, 4)}&m=${Number(d4.slice(5, 7))}`);
  await page.waitForTimeout(2500);
  const section = page.locator("button", { hasText: "シフト希望" }).first().locator("xpath=..");
  const tanakaChips = section.locator("span.ring-1", { hasText: "田中まとめ" });
  log("まとめて申請した人は、一覧の各日に色付きで出る（3日分）", (await tanakaChips.count()) === 3);
  const classes = await tanakaChips.evaluateAll((els) => els.map((e) => e.className));
  log("同じ申請の日は同じ色", new Set(classes).size === 1);
  log("1日だけの申請は色なし", (await section.locator("span.ring-1", { hasText: "佐藤ひとつ" }).count()) === 0);
  await page.screenshot({ path: "/tmp/srg-list.png" });

  // 日別の詳細（4日後を開く）
  await page.goto(`http://localhost:3000/company/calendar?date=${d4}`);
  await page.waitForTimeout(2500);
  const group = page.getByTestId("request-group");
  const groupText = await group.first().innerText().catch(() => "");
  const sd = (x) => `${Number(x.slice(5, 7))}/${Number(x.slice(8, 10))}`;
  log("日別の詳細に「同じ申請：」と申請した日が出る", groupText.includes(`同じ申請：${sd(d3)}・${sd(d4)}・${sd(d5)}`));
  log("日別の詳細でも1日だけの申請には出ない", (await group.count()) === 1);
  await page.screenshot({ path: "/tmp/srg-day.png" });

  console.log(process.exitCode ? "SHIFT REQUEST GROUPS SMOKE TEST HAD FAILURES" : "SHIFT REQUEST GROUPS SMOKE TEST PASSED");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "/tmp/srg-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
