import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// スタッフ名簿の上の並びを検証する：
// ・タブの下に「登録数 ◯件」と、検索・チーム絞り込み・追加ボタンが1行に並ぶ
// ・検索で絞ると「◯件中 ◯件」になる
// ・スマホも1行で、右端が一覧の枠とそろう。検索欄をタップすると広がる
// ・依頼主一覧に「今月のシフト」列があり、今月シフトのある相手が上に来る

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(
    `PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`,
  )
    .toString()
    .trim();
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const suffix = Date.now();
const email = `roster-toolbar-${suffix}@example.com`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "名簿並び確認");
  await page.fill("#email", email);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", `名簿並び株式会社${suffix}`);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='名簿並び株式会社${suffix}';`);
  const userId = psql(`select id from "User" where email='${email}';`);

  // 依頼主を2つ（仮アカウント）作る。後から作った方にだけ今月のシフトを入れる
  await page.goto("http://localhost:3000/company/roster?tab=clients");
  for (const name of ["動いてない依頼主", "動いてる依頼主"]) {
    await page.click("text=＋依頼主を追加");
    await page.click("text=仮アカウントを作成");
    await page.fill('input[placeholder="名称を入力"]', name);
    await page.getByRole("button", { name: "作成", exact: true }).click();
    await page.waitForTimeout(800);
  }
  const activeRel = psql(
    `select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' and "proxyName"='動いてる依頼主';`,
  );
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  for (let i = 0; i < 2; i++) {
    psql(
      `insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", date, "isAllDay", "isUndecided", status, "createdVia", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${userId}', 'CLIENT', '${activeRel}', '${today}', true, false, 'CONFIRMED', 'ASSIGN', now());`,
    );
  }

  await page.goto("http://localhost:3000/company/roster?tab=clients");
  await page.waitForTimeout(500);
  await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/roster-clients.png` : "/dev/null" });

  // 件数・検索・絞り込み・追加ボタンがタブより下の1行にある
  const tabBox = await page.getByRole("button", { name: "依頼主一覧" }).boundingBox();
  const search = page.getByPlaceholder("名称で検索");
  const searchBox = await search.boundingBox();
  const addBox = await page.getByRole("button", { name: "＋依頼主を追加" }).boundingBox();
  const filterBox = await page.getByRole("combobox", { name: "チームで絞り込む" }).boundingBox();
  const countText = page.locator("main p[aria-live]");
  const countBox = await countText.boundingBox();
  log("検索欄がタブより下にある", searchBox.y > tabBox.y + tabBox.height - 2);
  log(
    "登録数・検索・絞り込み・追加ボタンが同じ行に並ぶ",
    [searchBox, addBox, filterBox].every((b) => Math.abs(b.y + b.height / 2 - (countBox.y + countBox.height / 2)) < 8),
  );
  log("左から 検索 → 絞り込み → 追加 の順", searchBox.x < filterBox.x && filterBox.x < addBox.x);
  log("「登録数 2件」と出る", (await countText.innerText()).replace(/\s/g, "") === "登録数2件");

  const headers = (await page.locator("main table th").allInnerTexts()).map((t) => t.trim());
  log("「今月のシフト」列がある", headers.includes("今月のシフト"));
  const rows = (await page.locator("main table tbody tr").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  log("今月シフトのある依頼主が上に来る", rows[0]?.startsWith("動いてる依頼主") && rows[1]?.startsWith("動いてない依頼主"));
  log("件数が出る（2件・0件）", rows[0]?.includes("2件") && rows[1]?.includes("0件"));

  await search.fill("動いてない");
  await page.waitForTimeout(200);
  log("検索すると「2件中 1件」になる", (await countText.innerText()).replace(/\s/g, "") === "2件中1件");

  // スタッフ一覧も同じ並び
  await page.getByRole("button", { name: "スタッフ一覧" }).click();
  await page.waitForTimeout(200);
  log("スタッフ一覧では「氏名で検索」「＋スタッフを追加」", await page.getByPlaceholder("氏名で検索").isVisible() && await page.getByRole("button", { name: "＋スタッフを追加" }).isVisible());
  await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/roster-staff.png` : "/dev/null" });

  // スマホ：1行で並び、右端が一覧の枠とそろう。検索欄をタップすると広がる
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:3000/company/roster?tab=clients");
  await page.waitForTimeout(500);
  const mCount = page.locator("main p[aria-live]");
  const mSearch = page.getByPlaceholder("名称で検索");
  const mAdd = page.getByRole("button", { name: "＋依頼主を追加" });
  log("スマホでも登録数が出る", (await mCount.innerText()).replace(/\s/g, "") === "登録数2件");
  const [cb, sb, ab] = [await mCount.boundingBox(), await mSearch.boundingBox(), await mAdd.boundingBox()];
  const mid = (b) => b.y + b.height / 2;
  log("スマホでも件数・検索・追加ボタンが1行に並ぶ", Math.abs(mid(cb) - mid(sb)) < 6 && Math.abs(mid(sb) - mid(ab)) < 6);
  const card = await page.locator("main button", { hasText: "動いてる依頼主" }).boundingBox();
  log(
    "左右の端が一覧の枠とそろう",
    Math.abs(cb.x - card.x) < 2 && Math.abs(ab.x + ab.width - (card.x + card.width)) < 2,
  );
  log("検索欄と追加ボタンの高さがそろう", Math.abs(sb.height - ab.height) < 1);
  await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/roster-mobile.png` : "/dev/null" });
  await mSearch.click();
  await page.waitForTimeout(400);
  const wide = await mSearch.boundingBox();
  log("タップすると検索欄が広がる", wide.width > sb.width + 100);
  log("広がっている間は追加ボタンを隠す", !(await mAdd.isVisible()));
  await mSearch.fill("動いて");
  await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/roster-mobile-search.png` : "/dev/null" });
  await page.getByRole("button", { name: "検索をクリア" }).click();
  log("×で検索を消しても広がったまま", (await mSearch.inputValue()) === "" && (await mSearch.boundingBox()).width > sb.width + 100);
  await page.mouse.click(200, 760);
  await page.waitForTimeout(400);
  log("外をタップすると元に戻る", (await mAdd.isVisible()) && (await mSearch.boundingBox()).width < sb.width + 2);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(process.exitCode ? "ROSTER TOOLBAR SMOKE TEST FAILED" : "ROSTER TOOLBAR SMOKE TEST PASSED");
