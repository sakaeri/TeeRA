import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 会社からスタッフへのお知らせ：
// ・ダッシュボードで書くと、自社スタッフ（＋派遣スタッフ）のホームの「お知らせ」に出る
// ・チームを選ぶとそのチームのスタッフだけ、「派遣スタッフにも出す」を外すと派遣スタッフには出ない
// ・既読の人数が出る、削除するとスタッフのホームからも消える、掲載期限を過ぎたら出ない

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

  const post = async ({ title, body, team, agency = true, expires }) => {
    await admin.goto("http://localhost:3000/company");
    await admin.getByRole("button", { name: "＋お知らせを出す" }).click();
    await admin.getByLabel("件名（必須）").fill(title);
    if (body) await admin.getByLabel("本文").fill(body);
    if (team) await admin.getByLabel("宛先").selectOption({ label: `${team}のスタッフ` });
    if (!agency) await admin.getByLabel("派遣スタッフ（派遣会社から来ているスタッフ）にも出す").uncheck();
    if (expires) await admin.locator('input[type="date"]').fill(expires);
    await admin.getByRole("button", { name: "お知らせを出す", exact: true }).click();
    await admin.getByText(/人にお知らせしました/).waitFor({ timeout: 15000 });
  };

  // 全員宛て（派遣スタッフも）
  await post({ title: "全員へのお知らせ", body: "年末年始は12/29〜1/3お休みです" });
  log(
    "全員宛ては自社スタッフ（チームの有無を問わず）と派遣スタッフに届く",
    noticeFor(realStaffId, "全員へのお知らせ") === "1" && noticeFor(otherStaff, "全員へのお知らせ") === "1" && noticeFor(agencyStaff, "全員へのお知らせ") === "1",
  );

  // チームA宛て・派遣スタッフ除く
  await post({ title: "チームAだけ", team: "チームA", agency: false });
  log(
    "チーム宛てはそのチームのスタッフだけ（派遣スタッフ除く）",
    noticeFor(realStaffId, "チームAだけ") === "1" && noticeFor(otherStaff, "チームAだけ") === "0" && noticeFor(agencyStaff, "チームAだけ") === "0",
  );

  // 期限切れ
  await post({ title: "期限切れのお知らせ", expires: "2020-01-01" });

  // スタッフのホーム
  await staff.goto("http://localhost:3000/staff");
  await staff.waitForTimeout(1200);
  let home = await staff.textContent("body");
  log("スタッフのホームに件名と本文が出る", home.includes("【全員へのお知らせ】") && home.includes("年末年始は12/29〜1/3お休みです"));
  log("チーム宛てのお知らせも出る", home.includes("【チームAだけ】"));
  log("掲載期限を過ぎたお知らせは出ない", !home.includes("期限切れのお知らせ"));

  // 既読 → 会社側に既読数
  await staff.locator("li", { hasText: "【全員へのお知らせ】" }).getByRole("button", { name: "既読にする" }).click();
  await staff.waitForTimeout(800);
  await admin.goto("http://localhost:3000/company");
  await admin.waitForTimeout(800);
  const card = await admin.locator("section", { hasText: "スタッフへのお知らせ" }).last().innerText();
  log("会社側に既読の人数が出る（1/3人）", card.includes("既読 1/3人"));

  // 削除
  admin.once("dialog", (d) => d.accept());
  await admin.locator("li", { hasText: "チームAだけ" }).getByRole("button", { name: "削除" }).click();
  await admin.waitForTimeout(1000);
  log("削除するとスタッフのお知らせも消える", noticeFor(realStaffId, "チームAだけ") === "0");
  await staff.goto("http://localhost:3000/staff");
  await staff.waitForTimeout(1000);
  home = await staff.textContent("body");
  log("削除したお知らせはスタッフのホームに出ない", !home.includes("【チームAだけ】"));

  console.log(process.exitCode ? "COMPANY ANNOUNCEMENTS SMOKE TEST HAD FAILURES" : "COMPANY ANNOUNCEMENTS SMOKE TEST PASSED");
} catch (err) {
  console.error("COMPANY ANNOUNCEMENTS SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
