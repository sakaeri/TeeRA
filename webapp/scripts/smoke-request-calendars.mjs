import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// シフト希望を月のカレンダーで見せる：
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
  await page.fill("#email", `rcal-${s}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", `希望暦${s}`);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='希望暦${s}';`);
  const staff = (name) => {
    const id = psql(`insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'rcal-${name}-${s}@example.com', 'x', '${name}', now()) returning id;`);
    psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${id}', '${companyId}', 'STAFF');`);
    return id;
  };
  const a = staff("田中");
  const b = staff("佐藤");
  const ym = psql(`select to_char(date_trunc('month', (now() at time zone 'Asia/Tokyo')) + interval '1 month', 'YYYY-MM');`);
  const [y, m] = ym.split("-").map(Number);
  psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status, note) values (gen_random_uuid()::text, '${a}', '${companyId}', 'WORK', ARRAY['${ym}-10','${ym}-12','${ym}-15']::date[], 'PENDING', '早番希望');`);
  psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status) values (gen_random_uuid()::text, '${b}', '${companyId}', 'WORK', ARRAY['${ym}-12']::date[], 'PENDING');`);

  // --- カレンダーの上の「シフト希望」の欄はなくした ---
  await page.goto("http://localhost:3000/company/calendar");
  await page.waitForTimeout(2500);
  log("カレンダーの上にシフト希望の欄は出ない", (await page.getByTestId("request-count-calendar").count()) === 0);

  // --- ダッシュボードの未確定シフト ---
  await page.goto("http://localhost:3000/company?open=unconfirmed");
  await page.waitForTimeout(2500);
  const calendars = page.getByTestId("request-dates-calendar");
  log("申請ごとに、申請した日の小さなカレンダーが出る", (await calendars.count()) === 2);
  const tanakaDays = await page
    .locator("div.rounded-xl", { hasText: "田中さん（出勤希望）" })
    .last()
    .locator("[data-requested=true]")
    .allInnerTexts();
  log("田中さんの申請は10・12・15日に色が付く", JSON.stringify(tanakaDays) === JSON.stringify(["10", "12", "15"]));
  const note = page.getByTestId("request-note");
  log("備考はカレンダーの下に出る", (await note.innerText()).includes("備考：早番希望"));
  await page.screenshot({ path: "/tmp/rcal-dashboard.png" });

  // --- 「この申請でシフトを作る」：そのスタッフ・その申請の日が全部選ばれた状態でシフト作成が開く ---
  await page.locator("div.rounded-xl", { hasText: "田中さん（出勤希望）" }).last().getByTestId("create-shift-from-request").click();
  await page.waitForURL(/\/company\/calendar/);
  const modal = page.locator("div.fixed.inset-0.z-20").last();
  await modal.getByRole("button", { name: /社内（自社スタッフとして勤務）/ }).click({ timeout: 60000 });
  await modal.getByRole("button", { name: "業務内容を選ばずに次へ" }).click();
  await modal.getByText("日付を選択（複数選択可）").waitFor();
  const selected = await modal.locator("button[data-selected=true]").allInnerTexts();
  log("申請の日（10・12・15日）が最初から選ばれている", JSON.stringify(selected.map((t) => t.trim())) === JSON.stringify(["10", "12", "15"]));
  log("田中さんが選ばれている", (await modal.innerText()).includes("田中"));
  log("URLから申請の指定が消える", !page.url().includes("assignRequest"));
  await page.screenshot({ path: "/tmp/rcal-assign.png" });

  console.log(process.exitCode ? "REQUEST CALENDARS SMOKE TEST HAD FAILURES" : "REQUEST CALENDARS SMOKE TEST PASSED");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "/tmp/rcal-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
