import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 休み希望を会社側でも見えるようにする：
// ・ダッシュボードの「未確定シフト」に休み希望のカードが出て、「確認した」で消える（休み希望自体は有効なまま）
// ・出勤希望のカードのカレンダーに、そのスタッフの休み希望の日を薄い赤で添える
// ・シフト作成の日付選択で、選んだスタッフの休み希望の日が薄い赤になる
// ・日付の詳細に、その日の休み希望が表示だけされる

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
  await page.fill("#email", `offreq-${s}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", `休み希望${s}`);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='休み希望${s}';`);
  const staffId = psql(`insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'offreq-st-${s}@example.com', 'x', '田中', now()) returning id;`);
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);
  const ym = psql(`select to_char(date_trunc('month', (now() at time zone 'Asia/Tokyo')) + interval '1 month', 'YYYY-MM');`);
  const [y, m] = ym.split("-").map(Number);
  const workId = psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'WORK', ARRAY['${ym}-10','${ym}-12']::date[], 'PENDING') returning id;`);
  const offId = psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status, note) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'OFF', ARRAY['${ym}-20','${ym}-21']::date[], 'PENDING', '通院') returning id;`);

  // --- ダッシュボード ---
  await page.goto("http://localhost:3000/company?open=unconfirmed");
  await page.waitForTimeout(2500);
  const cards = page.getByTestId("unconfirmed-card");
  log("出勤希望と休み希望の2枚のカードが出る", (await cards.count()) === 2);
  const workCard = cards.filter({ hasText: "田中さん（出勤希望）" });
  const offInWork = await workCard.locator("[data-off=true]").allInnerTexts();
  log("出勤希望のカードに休み希望の日（20・21日）が薄い赤で出る", JSON.stringify(offInWork) === JSON.stringify(["20", "21"]));
  const offCard = cards.filter({ hasText: "田中さん（休み希望）" });
  log("休み希望のカードに備考が出る", (await offCard.innerText()).includes("備考：通院"));
  await page.screenshot({ path: "/tmp/offreq-dashboard.png", fullPage: true });
  await offCard.getByTestId("acknowledge-off-request").click();
  await page.waitForTimeout(1500);
  const afterAck = await page.getByTestId("unconfirmed-card").count();
  console.log("cards after ack", afterAck);
  await page.screenshot({ path: "/tmp/offreq-afterack.png" });
  log("「確認した」で休み希望のカードが消える", afterAck === 1);
  // 一覧を閉じると件数が読み直される（出勤希望の1件だけになる）
  await page.getByRole("button", { name: "✕" }).first().click();
  await page.waitForTimeout(2000);
  log("一覧を閉じると未確定シフトの件数が1件になる", /未確定シフト\s*1\s*件/.test(await page.locator("body").innerText()));
  log("確認日時が記録される（休み希望自体は有効なまま）", psql(`select ("acknowledgedAt" is not null) || ',' || status from "ShiftRequest" where id='${offId}';`) === "true,PENDING");
  await page.goto("http://localhost:3000/company?open=unconfirmed");
  await page.waitForTimeout(2500);
  log("開き直しても休み希望のカードは出ない", (await page.getByTestId("unconfirmed-card").count()) === 1);

  // --- シフト作成の日付選択 ---
  await page.getByTestId("create-shift-from-request").click();
  await page.waitForURL(/\/company\/calendar/);
  const modal = page.locator("div.fixed.inset-0.z-20").last();
  await modal.getByRole("button", { name: /社内（自社スタッフとして勤務）/ }).click({ timeout: 60000 });
  await modal.getByRole("button", { name: "業務内容を選ばずに次へ" }).click();
  await modal.getByText("日付を選択（複数選択可）").waitFor();
  const offDays = await modal.locator("button[data-off=true]").allInnerTexts();
  log("シフト作成の日付選択で休み希望の日（20・21日）が薄い赤になる", JSON.stringify(offDays.map((t) => t.trim())) === JSON.stringify(["20", "21"]));
  log("休み希望の説明と備考が出る", (await modal.getByTestId("off-legend").innerText()).includes("田中さんの休み希望（備考：通院）"));
  await page.screenshot({ path: "/tmp/offreq-assign.png" });

  // --- 日付の詳細 ---
  await page.goto(`http://localhost:3000/company/calendar?date=${ym}-20`);
  await page.waitForTimeout(2500);
  const dayOff = page.getByTestId("day-off-requests");
  log("日付の詳細に休み希望が出る", (await dayOff.innerText()).includes("田中さん") && (await dayOff.innerText()).includes("通院"));
  void workId;
  void y;
  void m;

  console.log(process.exitCode ? "OFF REQUESTS SMOKE TEST HAD FAILURES" : "OFF REQUESTS SMOKE TEST PASSED");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "/tmp/offreq-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
