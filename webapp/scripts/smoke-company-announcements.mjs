import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 会社からスタッフへのお知らせ：
// ・宛先は「全スタッフ（自社＋派遣）／自社スタッフのみ／チームを選ぶ／個別に選ぶ」
// ・スタッフは「お知らせ」メニューに溜まり（会社名・タイトル・掲載日、未読は太字・数字のバッジ）、
//   ホームの上には未読が最大3件＋「すべて見る」。開くと既読、すべて既読にもできる
// ・会社側で直すとスタッフのお知らせにも反映（編集済み）、削除するとスタッフからも消える
// ・添付ファイルは受け取ったスタッフと会社の人だけが開ける

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
const admin = await (await browser.newContext()).newPage();
const staff = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const suffix = Date.now();
const companyName = `お知らせ確認株式会社${suffix}`;
const staffEmail = `announce-staff-${suffix}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "お知らせ本部");
  await admin.fill("#email", `announce-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  // 本物のスタッフ（ホームで確認する人）
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "お知らせスタッフ");
  await staff.fill("#email", staffEmail);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL(/\/staff/);
  const realStaffId = psql(`select id from "User" where email='${staffEmail}';`);

  // チームA（本物のスタッフが所属）、チームに入っていない自社スタッフ、派遣スタッフ
  const teamA = psql(
    `with ins as (insert into "Team" (id, "companyId", name) values (gen_random_uuid()::text, '${companyId}', 'チームA') returning id) select id from ins;`,
  );
  psql(`insert into "TeamMembership" (id, "teamId", "userId", role) values (gen_random_uuid()::text, '${teamA}', '${realStaffId}', 'TEAM_MEMBER');`);
  const user = (name) =>
    psql(
      `with ins as (insert into "User" (id, email, name, "createdAt", "updatedAt") values (gen_random_uuid()::text, 'ann-${suffix}-' || floor(random()*1e9)::text || '@example.com', '${name}', now(), now()) returning id) select id from ins;`,
    );
  const otherStaff = user("チーム外スタッフ");
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${otherStaff}', '${companyId}', 'STAFF');`);
  const agencyCompany = psql(
    `with ins as (insert into "Company" (id, name, "createdAt", "updatedAt") values (gen_random_uuid()::text, '派遣元${suffix}', now(), now()) returning id) select id from ins;`,
  );
  const rel = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "clientCompanyId", status, "createdAt") values (gen_random_uuid()::text, '${agencyCompany}', '${agencyCompany}', '${companyId}', 'ACTIVE', now()) returning id) select id from ins;`,
  );
  const agencyStaff = user("派遣スタッフ");
  psql(`insert into "StaffPlacement" (id, "staffUserId", "companyRelationshipId", active) values (gen_random_uuid()::text, '${agencyStaff}', '${rel}', true);`);

  const noticeFor = (uid, title) =>
    psql(`select count(*) from "StaffNotice" n join "CompanyAnnouncement" a on a.id=n."companyAnnouncementId" where n."staffUserId"='${uid}' and a.title='${title}';`);

  const post = async ({ title, body, audience, teams = [], people = [] }) => {
    await admin.goto("http://localhost:3000/company");
    await admin.getByRole("button", { name: "お知らせ", exact: true }).click();
  await admin.getByRole("button", { name: "お知らせ", exact: true }).click();
    await admin.getByRole("button", { name: "＋お知らせを作成" }).click();
    await admin.getByLabel("件名（必須）").fill(title);
    if (body) await admin.getByLabel("本文").fill(body);
    if (audience) await admin.getByLabel("宛先").selectOption({ label: audience });
    for (const t of teams) await admin.getByRole("group", { name: "チーム" }).getByLabel(t).check();
    for (const p of people) {
      await admin.getByPlaceholder("名前で探す").fill(p);
      await admin.getByRole("group", { name: "スタッフ" }).getByLabel(p).check();
    }
    await admin.getByRole("button", { name: "お知らせを出す", exact: true }).click();
    await admin.getByText(/人にお知らせしました/).waitFor({ timeout: 15000 });
  };

  // ダッシュボードの「よく使う操作」から開ける
  await admin.goto("http://localhost:3000/company?announce=1#announcements");
  log("「お知らせを作成」で入力欄が開いた状態になる", (await admin.getByLabel("件名（必須）").count()) === 1);
  const tabLabels = await admin
    .locator("section", { has: admin.getByRole("button", { name: "解決済み", exact: true }) })
    .last()
    .locator("> div").first()
    .getByRole("button")
    .allInnerTexts();
  log("お知らせはダッシュボードのタブ（やること・お知らせ・解決済み・販促品・注文履歴）の2番目に並ぶ", tabLabels.join(",") === "やること,お知らせ,解決済み,販促品,注文履歴");
  await admin.getByRole("button", { name: "販促品", exact: true }).click();
  await admin.getByRole("button", { name: "＋販促品を登録" }).click();
  log("販促品のタブから販促品の登録画面が開く", await admin.getByText("画像2（任意）").isVisible());

  await post({ title: "全員へのお知らせ", body: "年末年始は12/29〜1/3お休みです" });
  log(
    "全スタッフ宛ては自社スタッフと派遣スタッフに届く",
    noticeFor(realStaffId, "全員へのお知らせ") === "1" && noticeFor(otherStaff, "全員へのお知らせ") === "1" && noticeFor(agencyStaff, "全員へのお知らせ") === "1",
  );
  await post({ title: "自社だけ", audience: "自社スタッフのみ" });
  log(
    "自社スタッフのみは派遣スタッフに届かない",
    noticeFor(realStaffId, "自社だけ") === "1" && noticeFor(otherStaff, "自社だけ") === "1" && noticeFor(agencyStaff, "自社だけ") === "0",
  );
  await post({ title: "チームAだけ", audience: "チームを選ぶ", teams: ["チームA"] });
  log(
    "チーム宛てはそのチームのスタッフだけ",
    noticeFor(realStaffId, "チームAだけ") === "1" && noticeFor(otherStaff, "チームAだけ") === "0" && noticeFor(agencyStaff, "チームAだけ") === "0",
  );
  await post({ title: "個別のお知らせ", audience: "個別に選ぶ", people: ["お知らせスタッフ", "派遣スタッフ"] });
  log(
    "個別は選んだ人だけ（派遣スタッフも選べる）",
    noticeFor(realStaffId, "個別のお知らせ") === "1" && noticeFor(otherStaff, "個別のお知らせ") === "0" && noticeFor(agencyStaff, "個別のお知らせ") === "1",
  );
  await admin.locator("#announcements").getByText("個別（2人）").waitFor({ timeout: 15000 }).catch(() => {});
  let card = await admin.locator("#announcements").innerText();
  log("会社側の一覧に宛先が出る", card.includes("チームA") && card.includes("個別（2人）") && card.includes("自社スタッフのみ"));
  log("既読の人数は出さない", !card.includes("既読"));

  // 添付（DBに直接付ける）— 受け取った人は開ける、受け取っていない人は開けない
  const annId = psql(`select id from "CompanyAnnouncement" where "companyId"='${companyId}' and title='全員へのお知らせ';`);
  const attId = psql(
    `insert into "NoteAttachment" (id, "companyAnnouncementId", url, "fileName", "contentType", size, "createdAt") values (gen_random_uuid()::text, '${annId}', 'http://localhost:3000/does-not-exist.png', '案内.png', 'image/png', 100, now()) returning id;`,
  );
  const teamOnlyId = psql(`select id from "CompanyAnnouncement" where "companyId"='${companyId}' and title='チームAだけ';`);
  const att2Id = psql(
    `insert into "NoteAttachment" (id, "companyAnnouncementId", url, "fileName", "contentType", size, "createdAt") values (gen_random_uuid()::text, '${teamOnlyId}', 'http://localhost:3000/does-not-exist.png', '別紙.png', 'image/png', 100, now()) returning id;`,
  );
  // 「チームAだけ」を本物のスタッフが受け取っていないことにして、開けないのを確かめる
  psql(`delete from "StaffNotice" where "companyAnnouncementId"='${teamOnlyId}' and "staffUserId"='${realStaffId}';`);
  const s1 = (await staff.request.get(`http://localhost:3000/api/note-attachments/${attId}`)).status();
  const s2 = (await staff.request.get(`http://localhost:3000/api/note-attachments/${att2Id}`)).status();
  log("受け取ったお知らせの添付は開ける（403にならない）", s1 !== 403);
  log("受け取っていないお知らせの添付は開けない（403）", s2 === 403);
  log("会社の管理者は添付を開ける", (await admin.request.get(`http://localhost:3000/api/note-attachments/${att2Id}`)).status() !== 403);

  // スタッフのホーム：未読が最大3件＋すべて見る
  await staff.goto("http://localhost:3000/staff");
  await staff.waitForTimeout(1200);
  const popupClose = staff.getByRole("button", { name: "✕", exact: true });
  if ((await popupClose.count()) > 0) await popupClose.first().click();
  let home = await staff.locator("main").innerText();
  log("ホームに「お知らせ（未読3件）」が出る", home.includes("お知らせ（未読3件）"));
  log("ホームには最大3件（新しい順）", home.includes("個別のお知らせ") && home.includes("自社だけ") && home.includes("全員へのお知らせ"));
  const navBadge = await staff.getByRole("link", { name: /お知らせ/ }).filter({ hasText: "3" }).count();
  log("メニューの「お知らせ」に未読数が出る", navBadge > 0);

  // お知らせの一覧
  await staff.getByRole("link", { name: "すべて見る" }).click();
  await staff.waitForURL(/\/staff\/notices/);
  await staff.waitForTimeout(500);
  let list = await staff.locator("main").innerText();
  log("一覧に会社名・タイトルが出る", list.includes(companyName) && list.includes("全員へのお知らせ"));
  const boldCount = await staff.locator("main li span.font-bold").count();
  log("未読は太字（3件）", boldCount === 3);
  await staff.locator("main li button", { hasText: "全員へのお知らせ" }).click();
  await staff.waitForTimeout(800);
  list = await staff.locator("main").innerText();
  log(
    "開くと本文と添付が出る",
    list.includes("年末年始は12/29〜1/3お休みです") && (await staff.getByRole("button", { name: "案内.pngを大きく表示" }).count()) === 1,
  );
  log("開くと既読になる", psql(`select count(*) from "StaffNotice" where "staffUserId"='${realStaffId}' and "readAt" is null;`) === "2");

  // 会社側で直す → スタッフにも反映（編集済み）。仮の添付（保存先が本物でない）は外しておく
  psql(`delete from "NoteAttachment" where id in ('${attId}', '${att2Id}');`);
  await admin.goto("http://localhost:3000/company");
  await admin.getByRole("button", { name: "お知らせ", exact: true }).click();
  await admin.locator("#announcements li", { hasText: "全員へのお知らせ" }).getByRole("button", { name: "編集" }).click();
  await admin.getByLabel("本文").fill("年末年始は12/28〜1/4お休みです");
  await admin.getByRole("button", { name: "保存する" }).click();
  await admin.waitForTimeout(1200);
  card = await admin.locator("#announcements").innerText();
  log("会社側に（編集済み）が出る", card.includes("（編集済み）") && card.includes("12/28〜1/4"));
  await staff.goto("http://localhost:3000/staff/notices");
  await staff.locator("main li button", { hasText: "全員へのお知らせ" }).click();
  await staff.waitForTimeout(500);
  list = await staff.locator("main").innerText();
  log("直した内容がスタッフにも反映される", list.includes("12/28〜1/4") && list.includes("（編集済み）"));
  log("直しても既読はそのまま", psql(`select count(*) from "StaffNotice" where "staffUserId"='${realStaffId}' and "readAt" is null;`) === "2");

  // すべて既読
  await staff.getByRole("button", { name: "すべて既読にする" }).click();
  await staff.waitForTimeout(800);
  log("すべて既読にできる", psql(`select count(*) from "StaffNotice" where "staffUserId"='${realStaffId}' and "readAt" is null;`) === "0");
  await staff.goto("http://localhost:3000/staff");
  await staff.waitForTimeout(800);
  home = await staff.locator("main").innerText();
  log("未読が無いとホームのお知らせ欄は出ない", !home.includes("お知らせ（未読"));

  // 削除
  admin.once("dialog", (d) => d.accept());
  await admin.locator("#announcements li", { hasText: "個別のお知らせ" }).getByRole("button", { name: "削除" }).click();
  await admin.waitForTimeout(1000);
  log("削除するとスタッフのお知らせも消える", noticeFor(realStaffId, "個別のお知らせ") === "0" && noticeFor(agencyStaff, "個別のお知らせ") === "0");
  await staff.goto("http://localhost:3000/staff/notices");
  await staff.waitForTimeout(500);
  list = await staff.locator("main").innerText();
  log("削除したお知らせは一覧に出ない", !list.includes("個別のお知らせ") && list.includes("全員へのお知らせ"));

  console.log(process.exitCode ? "COMPANY ANNOUNCEMENTS SMOKE TEST HAD FAILURES" : "COMPANY ANNOUNCEMENTS SMOKE TEST PASSED");
} catch (err) {
  console.error("COMPANY ANNOUNCEMENTS SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
