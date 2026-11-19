import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

async function pdfText(buffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(" ") + "\n";
  }
  return text;
}

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
  // 絞り込みと関係ないもの：静か社で取り消されたシフト（取消）と、自社の募集
  const otherStaff = psql(
    `insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'toolbar-other-${suffix}@example.com', 'x', '取消さん', now()) returning id;`,
  );
  const cancelledId = psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${otherStaff}', 'CLIENT', '${quiet}', '確認', '${today}', '09:00', '17:00', false, false, 'CANCELLED', 'ASSIGN', now(), now()) returning id;`,
  );
  psql(`insert into "ShiftCancellation" (id, "shiftId", "cancelledByCompanyId", source, "feeAmount") values (gen_random_uuid()::text, '${cancelledId}', '${companyId}', 'CLIENT_APP', 0);`);
  psql(
    `insert into "PublicRecruitment" (id, "companyId", title, date, "maxEntries", "lockedTee", status, visibility, "publishedAt", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '自社の募集', '${today}', 2, 0, 'PUBLISHED', 'ORDER', now(), now(), now());`,
  );

  // スタッフで絞り込む用：花子（シフトと出勤希望）と、関係ない太郎（シフト）。今日の枠があふれないよう、同じ月の隣の日に入れる
  const staffDay = psql(`select (case when extract(day from (now() at time zone 'Asia/Tokyo')::date) > 1 then (now() at time zone 'Asia/Tokyo')::date - 1 else (now() at time zone 'Asia/Tokyo')::date + 1 end)::text;`);
  const addStaff = (name, slug) => {
    const id = psql(`insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'toolbar-${slug}-${suffix}@example.com', 'x', '${name}', now()) returning id;`);
    psql(`insert into "CompanyMembership" (id, "companyId", "userId", role) values (gen_random_uuid()::text, '${companyId}', '${id}', 'STAFF');`);
    psql(
      `insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
        `values (gen_random_uuid()::text, '${companyId}', '${id}', 'INHOUSE', '${staffDay}', '09:00', '17:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now());`,
    );
    return id;
  };
  const hanakoId = addStaff("絞込花子", "hanako");
  addStaff("関係ない太郎", "taro");
  // 出勤希望：シフトのある日（枠は出ない）と、まだシフトの無い日（青枠）。休みで確定した日（「休み」の札）
  const freeDays = [2, 3, 4, 5, 6].map((d) => `${today.slice(0, 8)}${String(d).padStart(2, "0")}`).filter((d) => d !== today && d !== staffDay);
  const workOnlyDay = freeDays[0];
  const offDay = freeDays[1];
  // 依頼主（ゴルフ場）の現場：札は「袖ケ浦」のように頭の部分だけ、時間未定なら2行目は出さない
  const golfDay = freeDays[2];
  const golfRel = rel("袖ケ浦カンツリー倶楽部");
  psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${hanakoId}', 'CLIENT', '${golfRel}', 'キャディ', '${golfDay}', false, true, 'CONFIRMED', 'ASSIGN', now(), now());`,
  );
  psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status) values (gen_random_uuid()::text, '${hanakoId}', '${companyId}', 'WORK', ARRAY['${staffDay}','${workOnlyDay}']::date[], 'PENDING');`);
  psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status, "acknowledgedAt") values (gen_random_uuid()::text, '${hanakoId}', '${companyId}', 'OFF', ARRAY['${offDay}']::date[], 'PENDING', now());`);

  await page.goto("http://localhost:3000/company/calendar");
  const [y, m] = today.split("-").map(Number);
  await page.getByText(`${y}年${m}月`, { exact: true }).first().waitFor();
  log("上部に 年月・絞り込み・PDF・画像 が並ぶ", await page.getByRole("button", { name: "絞り込み", exact: true }).isVisible());
  log("前の月・次の月のボタンがある", (await page.getByRole("button", { name: "次の月" }).count()) === 1);

  // 絞り込みの一覧
  const todayCell0 = page.locator(`button:has(> span:text-is("${Number(today.slice(8, 10))}"))`).first();
  const allCellText = await todayCell0.innerText();
  log("絞り込みなしでは、取消と募集が出る", allCellText.includes("取消") && allCellText.includes("募集"));
  await page.getByRole("button", { name: "絞り込み", exact: true }).click();
  const sheet = page.locator("div.fixed.inset-0.z-40").last();
  await sheet.getByTestId("filter-group-依頼主").waitFor();
  log("項目は最初は折りたたまれている（依頼主の名前は出ない）", (await sheet.getByText("たちつ多い社").count()) === 0);
  log("「チーム」「スタッフ」「依頼主」の項目が並ぶ", (await sheet.getByTestId("filter-group-スタッフ").count()) === 1);
  await sheet.getByTestId("filter-group-依頼主").click();
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
  const todayCell = page.locator(`button:has(> span:text-is("${Number(today.slice(8, 10))}"))`).first();
  const filteredCellText = await todayCell.innerText();
  log("絞り込み中は、別の依頼主で取り消されたシフト（取消）は出ない", !filteredCellText.includes("取消"));
  log("依頼主で絞り込み中は、自社の募集は出ない", !filteredCellText.includes("募集"));
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

  // スタッフで絞り込み：そのスタッフのシフトと出勤希望だけ。募集は出ない
  await page.getByRole("button", { name: "絞り込み", exact: true }).click();
  const sheet3 = page.locator("div.fixed.inset-0.z-40").last();
  await sheet3.getByTestId("filter-group-スタッフ").click();
  await sheet3.getByRole("button", { name: "絞込花子" }).click();
  await page.waitForURL(/staff=/);
  await page.getByRole("button", { name: "絞り込みを解除" }).waitFor();
  log("スタッフで絞り込むと「絞込花子さん ✕」が出る", (await page.getByTestId("calendar-filter-chip").innerText()).includes("絞込花子さん"));
  const staffCell = page.locator(`button:has(> span:text-is("${Number(staffDay.slice(8, 10))}"))`).first();
  const staffCellText = await staffCell.innerText();
  const todayCellStaff = await page.locator(`button:has(> span:text-is("${Number(today.slice(8, 10))}"))`).first().innerText();
  log("そのスタッフのシフトだけが出る（他の人・募集は出ない）", !staffCellText.includes("太郎") && !todayCellStaff.includes("募集"));
  // 前日のシフト（報告がまだ）は2行目が「未報告」、翌日なら時間
  log(
    "札には名前ではなく勤務先と、時間（過ぎて報告がまだなら「未報告」）が出る",
    staffCellText.includes("自社") && !staffCellText.includes("絞込") && (staffDay < today ? staffCellText.includes("未報告") : staffCellText.includes("9:00〜")),
  );
  const legendBox = await page.getByTestId("staff-request-legend").boundingBox();
  log("色の説明（出勤希望・休み希望・休み確定・未報告）が1行に収まる", legendBox.height < 20 && (await page.getByTestId("staff-request-legend").innerText()).includes("未報告"));
  const cellOf = (d) => page.locator(`button:has(> span:text-is("${Number(d.slice(8, 10))}"))`).first();
  log("出勤希望の日にシフトを作った日は枠を出さない（名前の札だけ）", (await staffCell.getAttribute("data-request-desire")) === null);
  log("まだシフトの無い出勤希望の日は青枠", (await cellOf(workOnlyDay).getAttribute("data-request-desire")) === "WORK");
  const golfText = await cellOf(golfDay).innerText();
  log("ゴルフ場の名前は頭の部分だけ（袖ケ浦）・時間未定は「未定」を書かない", golfText.includes("袖ケ浦") && !golfText.includes("カンツリー") && !golfText.includes("未定"));
  log("休みで確定した日は「休み」の札", (await cellOf(offDay).getAttribute("data-request-desire")) === "OFF_CONFIRMED" && (await cellOf(offDay).innerText()).includes("休み"));
  log("色の説明が出る", (await page.getByTestId("staff-request-legend").count()) === 1);
  // PDF（シフト表）もそのスタッフだけ
  const pdfRes = await page.request.get(`http://localhost:3000/api/calendar/pdf?y=${y}&m=${m}&staff=${hanakoId}`);
  const pdf = await pdfText(await pdfRes.body());
  log("PDFもそのスタッフだけ（タイトルに「スタッフ：絞込花子」）", pdf.includes("絞込花子") && !pdf.includes("関係ない太郎") && pdf.includes("スタッフ："));
  await page.getByRole("button", { name: "絞り込み", exact: true }).click();
  const sheet4 = page.locator("div.fixed.inset-0.z-40").last();
  log("最近使った絞り込みに種類（スタッフ）が出る", (await sheet4.innerText()).includes("スタッフ"));
  log("選択中の項目（スタッフ）は開いた状態で出る", (await sheet4.getByRole("button", { name: "絞込花子" }).count()) >= 1 && (await sheet4.getByText("たちつ多い社").count()) <= 1);
  await sheet4.getByRole("button", { name: "閉じる" }).click();
  await page.getByRole("button", { name: "絞り込みを解除" }).click();
  await page.waitForURL((url) => !url.search.includes("staff="));

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
