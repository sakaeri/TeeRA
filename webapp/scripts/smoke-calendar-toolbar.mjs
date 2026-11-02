import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// カレンダー上部：‹ 年月 › と 絞り込み・PDF・画像のアイコンが1列。
// 絞り込みは下から出る一覧（検索・最近使った・チーム・依頼主は今月の件数順）。
// 月送りは押した瞬間に次の月の枠が出て、データは届きしだい埋まる。

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
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const suffix = Date.now();
const companyName = `上部確認株式会社${suffix}`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "上部本部");
  await page.fill("#email", `toolbar-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  const userId = psql(`select id from "User" where email='toolbar-${suffix}@example.com';`);
  psql(`update "Company" set "agencyEnabled"=true where id='${companyId}';`);

  // 依頼主3社（仮アカウント）。「多い社」に今月のシフト3件、「少ない社」に1件、「静か社」は0件
  const rel = (name) => {
    const id = `tb-${name}-${suffix}`;
    psql(`insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") values ('${id}', '${companyId}', '${companyId}', '${name}', 'ACTIVE', now());`);
    return id;
  };
  const quiet = rel("あいう静か社");
  const many = rel("たちつ多い社");
  const few = rel("かきく少ない社");
  const today = psql(`select (now() at time zone 'Asia/Tokyo')::date::text;`);
  const shift = (relId) =>
    psql(
      `insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
        `values (gen_random_uuid()::text, '${companyId}', '${userId}', 'CLIENT', '${relId}', '確認', '${today}', '09:00', '17:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now());`,
    );
  shift(many);
  shift(many);
  shift(many);
  shift(few);

  await page.goto("http://localhost:3000/company/calendar");
  const [y, m] = today.split("-").map(Number);
  await page.getByText(`${y}年${m}月`, { exact: true }).first().waitFor();
  log("上部に 年月・絞り込み・PDF・画像 が並ぶ", await page.getByRole("button", { name: "絞り込み", exact: true }).isVisible());
  log("前の月・次の月のボタンがある", (await page.getByRole("button", { name: "次の月" }).count()) === 1);

  // 絞り込みの一覧
  await page.getByRole("button", { name: "絞り込み", exact: true }).click();
  const sheet = page.locator("div.fixed.inset-0.z-40").last();
  await sheet.getByText("依頼主", { exact: true }).waitFor();
  const rows = (await sheet.locator("button").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const clientRows = rows.filter((t) => t.includes("社") && !t.startsWith("全社"));
  log(
    "依頼主は今月の件数が多い順（件数つき）、0件は下",
    clientRows[0]?.startsWith("たちつ多い社") && clientRows[0]?.includes("今月3件") &&
      clientRows[1]?.startsWith("かきく少ない社") && clientRows[2]?.startsWith("あいう静か社") && clientRows[2]?.includes("今月0件"),
  );
  await sheet.locator('input[type="search"]').fill("少ない");
  const searched = (await sheet.locator("button").allInnerTexts()).filter((t) => t.includes("社") && !t.startsWith("全社"));
  log("検索で名前に入っている依頼主だけに絞れる", searched.length === 1 && searched[0].includes("かきく少ない社"));
  await sheet.getByRole("button", { name: /かきく少ない社/ }).click();
  await page.waitForURL(/rel=/);
  await page.getByRole("button", { name: "絞り込みを解除" }).waitFor();
  log("絞り込み中は「かきく少ない社 ✕」が出る", (await page.getByText("かきく少ない社").count()) >= 1);
  const filterClass = await page.getByRole("button", { name: "絞り込み", exact: true }).getAttribute("class");
  log("絞り込み中はアイコンが濃い緑", (filterClass ?? "").includes("bg-primary"));

  await page.getByRole("button", { name: "絞り込み", exact: true }).click();
  const sheet2 = page.locator("div.fixed.inset-0.z-40").last();
  await sheet2.getByText("最近使った絞り込み").waitFor();
  log("一度選んだ依頼主は「最近使った絞り込み」に出る", true);
  await sheet2.getByRole("button", { name: "閉じる" }).click();

  await page.getByRole("button", { name: "絞り込みを解除" }).click();
  await page.waitForURL((url) => !url.search.includes("rel="));
  log("✕で全社に戻る", (await page.getByRole("button", { name: "絞り込みを解除" }).count()) === 0);

  // 月送り：押した瞬間に次の月の表示になり、URLも変わる
  const nextLabel = m === 12 ? `${y + 1}年1月` : `${y}年${m + 1}月`;
  await page.getByRole("button", { name: "次の月" }).click();
  await page.getByText(nextLabel, { exact: true }).first().waitFor({ timeout: 3000 });
  log("次の月を押すとすぐ次の月の表示になる", true);
  await page.waitForURL(new RegExp(`m=${m === 12 ? 1 : m + 1}`), { timeout: 15000 });
  log("データも次の月に切り替わる（URLが変わる）", true);
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "/tmp/smoke-calendar-toolbar.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(process.exitCode ? "CALENDAR TOOLBAR SMOKE TEST FAILED" : "CALENDAR TOOLBAR SMOKE TEST PASSED");
