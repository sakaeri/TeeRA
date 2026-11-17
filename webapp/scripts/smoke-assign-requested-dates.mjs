import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// シフト希望の行の「シフト作成」から開くと、日付の選択で、同じ申請（1回の申請）で希望した日に
// 薄く色が付く（選ぶ時の補助）。同じスタッフでも別の申請の日・ほかの人の希望の日には付かない。

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
  await page.fill("#email", `ard-${s}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", `希望補助${s}`);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='希望補助${s}';`);
  const staff = (name) => {
    const id = psql(`insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'ard-${name}-${s}@example.com', 'x', '${name}', now()) returning id;`);
    psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${id}', '${companyId}', 'STAFF');`);
    return id;
  };
  const ishihara = staff("石原克己");
  const other = staff("ほかの人");
  // 来月の10日・12日・15日（今日がどの日でも未来になるように）
  const ym = psql(`select to_char(date_trunc('month', (now() at time zone 'Asia/Tokyo')) + interval '1 month', 'YYYY-MM');`);
  const [d10, d12, d15, d20] = ["10", "12", "15", "20"].map((d) => `${ym}-${d}`);
  psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status) values (gen_random_uuid()::text, '${ishihara}', '${companyId}', 'WORK', ARRAY['${d10}','${d12}']::date[], 'PENDING');`);
  psql(`update "ShiftRequest" set note='早番希望' where "staffUserId"='${ishihara}' and dates @> ARRAY['${d10}']::date[];`);
  psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status) values (gen_random_uuid()::text, '${ishihara}', '${companyId}', 'WORK', ARRAY['${d15}']::date[], 'PENDING');`);
  psql(`update "ShiftRequest" set note='遅番希望' where "staffUserId"='${ishihara}' and dates @> ARRAY['${d15}']::date[];`);
  psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status) values (gen_random_uuid()::text, '${other}', '${companyId}', 'WORK', ARRAY['${d20}']::date[], 'PENDING');`);

  // 石原さんの希望の日（10日）の詳細から「シフト作成」→ 社内 → 業務内容なし → 日付と時間
  await page.goto(`http://localhost:3000/company/calendar?date=${d10}`);
  await page.waitForTimeout(2500);
  await page.locator("li", { hasText: "石原克己さん" }).getByRole("button", { name: "シフト作成" }).click();
  const modal = page.locator("div.fixed.inset-0.z-20").last();
  await modal.getByRole("button", { name: /社内（自社スタッフとして勤務）/ }).click();
  await modal.getByRole("button", { name: "業務内容を選ばずに次へ" }).click();
  await modal.getByText("日付を選択（複数選択可）").waitFor();
  const highlighted = await modal.locator("button[data-highlighted=true]").allInnerTexts();
  log("同じ申請で希望した日だけに色が付く（12日。10日は選択済み、別の申請の15日には付かない）", JSON.stringify(highlighted.map((t) => t.trim()).sort()) === JSON.stringify(["12"]));
  const legend1 = await modal.getByTestId("work-legend").innerText();
  log("色の意味と、その申請の備考が出る", legend1.includes("石原克己さんが同じ申請で希望した日") && legend1.includes("出勤希望（備考：早番希望）"));
  await page.screenshot({ path: "/tmp/ard.png" });
  // 10日の選択を外すと10日にも色が付く
  await modal.getByRole("button", { name: "10", exact: true }).click();
  const after = await modal.locator("button[data-highlighted=true]").allInnerTexts();
  log("選択を外した日にも色が付く（ほかの人の希望の20日には付かない）", JSON.stringify(after.map((t) => t.trim()).sort()) === JSON.stringify(["10", "12"]));

  // 申請から開かずに「シフトを作成」からスタッフを選んだ時も、そのスタッフの出勤希望（全部の申請）が青枠で出る
  await page.goto("http://localhost:3000/company/calendar?create=shift");
  const gm = page.locator("div.fixed.inset-0.z-20").last();
  await gm.getByRole("button", { name: /社内（自社スタッフとして勤務）/ }).click({ timeout: 60000 });
  await gm.getByRole("button", { name: "業務内容を選ばずに次へ" }).click();
  await gm.getByRole("button", { name: "石原克己" }).click();
  await gm.getByText("日付を選択（複数選択可）").waitFor();
  const ymNow = psql(`select to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM');`);
  if (ymNow !== ym) await gm.getByRole("button", { name: "次の月" }).click();
  const allReq = await gm.locator("button[data-highlighted=true]").allInnerTexts();
  log("申請から開かなくても、石原さんの出勤希望（10・12・15日）が青枠になる", JSON.stringify(allReq.map((t) => t.trim()).sort()) === JSON.stringify(["10", "12", "15"]));
  const legend2 = await gm.getByTestId("work-legend").innerText();
  log("説明は「石原克己さんの出勤希望」と、備考ごとの色の意味", legend2.includes("石原克己さんの出勤希望") && legend2.includes("出勤希望（備考：早番希望）") && legend2.includes("出勤希望（備考：遅番希望）"));
  const ringOf = async (d) => (await gm.getByRole("button", { name: d, exact: true }).getAttribute("class")) ?? "";
  log("備考ごとに枠の色が違う（早番＝紫、遅番＝橙）", (await ringOf("10")).includes("ring-violet-500") && (await ringOf("12")).includes("ring-violet-500") && (await ringOf("15")).includes("ring-orange-400"));
  await page.screenshot({ path: "/tmp/ard-generic.png" });

  // 過ぎた日のシフト希望は、日別の詳細にも出さない（シフトを作れないため）
  const yesterday = psql(`select to_char((now() at time zone 'Asia/Tokyo')::date - 1, 'YYYY-MM-DD');`);
  psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status) values (gen_random_uuid()::text, '${ishihara}', '${companyId}', 'WORK', ARRAY['${yesterday}']::date[], 'PENDING');`);
  await page.goto(`http://localhost:3000/company/calendar?date=${yesterday}`);
  await page.waitForTimeout(2500);
  log("過ぎた日の詳細には、シフト希望（シフト作成・見送る）が出ない", (await page.locator("li", { hasText: "石原克己さん" }).count()) === 0);

  console.log(process.exitCode ? "ASSIGN REQUESTED DATES SMOKE TEST HAD FAILURES" : "ASSIGN REQUESTED DATES SMOKE TEST PASSED");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "/tmp/ard-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
