import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// あとから入ったスタッフにも、過去のお知らせが届く：
// ・宛先が全スタッフ／自社スタッフのみ／自分のチームのものは、お知らせに未読で並ぶ（日付は元のまま）
// ・個別指定・ほかのチーム宛・掲載期限切れのものは入らない
// ・何度開いても二重には入らない

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
const companyName = `後入りお知らせ株式会社${suffix}`;
const staffEmail = `late-staff-${suffix}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "後入り本部");
  await admin.fill("#email", `late-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  const teamA = psql(`with ins as (insert into "Team" (id, "companyId", name) values (gen_random_uuid()::text, '${companyId}', 'チームA') returning id) select id from ins;`);
  const teamB = psql(`with ins as (insert into "Team" (id, "companyId", name) values (gen_random_uuid()::text, '${companyId}', 'チームB') returning id) select id from ins;`);

  // スタッフが入る前に出したお知らせ
  const announce = (title, audience, extra = "") =>
    psql(
      `insert into "CompanyAnnouncement" (id, "companyId", audience, "teamIds", "staffUserIds", title, body, pushed, "expiresOn", "createdAt") values (gen_random_uuid()::text, '${companyId}', '${audience}', ${extra || "'[]'"}, '[]', '${title}', '本文', true, null, '2026-09-01 10:00:00');`,
    );
  announce("全員向け過去", "ALL");
  announce("自社向け過去", "OWN");
  announce("チームA向け過去", "TEAMS", `'["${teamA}"]'`);
  announce("チームB向け過去", "TEAMS", `'["${teamB}"]'`);
  announce("個別向け過去", "INDIVIDUAL");
  psql(
    `insert into "CompanyAnnouncement" (id, "companyId", audience, "teamIds", "staffUserIds", title, body, pushed, "expiresOn", "createdAt") values (gen_random_uuid()::text, '${companyId}', 'ALL', '[]', '[]', '期限切れ過去', '本文', true, '2026-09-30', '2026-09-01 10:00:00');`,
  );

  // あとからスタッフが入る（チームAに加入）
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "後入りスタッフ");
  await staff.fill("#email", staffEmail);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL(/\/staff/);
  const staffId = psql(`select id from "User" where email='${staffEmail}';`);
  psql(`insert into "TeamMembership" (id, "teamId", "userId", role) values (gen_random_uuid()::text, '${teamA}', '${staffId}', 'TEAM_MEMBER');`);

  await staff.goto("http://localhost:3000/staff/notices");
  await staff.getByText("全員向け過去").first().waitFor({ timeout: 15000 });
  const text = await staff.locator("main").innerText();
  log("全スタッフ宛の過去のお知らせが見られる", text.includes("全員向け過去"));
  log("自社スタッフ宛の過去のお知らせが見られる", text.includes("自社向け過去"));
  log("自分のチーム宛の過去のお知らせが見られる", text.includes("チームA向け過去"));
  log("ほかのチーム宛は入らない", !text.includes("チームB向け過去"));
  log("個別指定は入らない", !text.includes("個別向け過去"));
  log("掲載期限切れは入らない", !text.includes("期限切れ過去"));
  const rows = () => psql(`select count(*) from "StaffNotice" where "staffUserId"='${staffId}' and "companyAnnouncementId" is not null;`);
  log("未読で、日付は元のお知らせのまま", psql(`select count(*) from "StaffNotice" where "staffUserId"='${staffId}' and "readAt" is null and "createdAt"='2026-09-01 10:00:00';`) === "3");
  await staff.goto("http://localhost:3000/staff");
  await staff.goto("http://localhost:3000/staff/notices");
  await staff.waitForTimeout(500);
  log("何度開いても二重には入らない", rows() === "3");

  console.log(process.exitCode ? "ANNOUNCEMENTS LATE JOINER SMOKE TEST HAD FAILURES" : "ANNOUNCEMENTS LATE JOINER SMOKE TEST PASSED");
} catch (err) {
  console.error("ANNOUNCEMENTS LATE JOINER SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
