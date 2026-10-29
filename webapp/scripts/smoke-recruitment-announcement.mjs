import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 募集の「追加のお知らせ」を検証する：
// ・募集を出した会社が、作った後にお知らせを書き足せる
// ・「通知する」にチェックしない時は通知しない（スタッフのお知らせ欄には出す）
// ・チェックした時は、エントリー済み・確定済みのスタッフにプッシュ通知
//   （受け取れない人にはメール）。派遣会社のスタッフも対象
// ・派遣会社は依頼主のオーダーのお知らせを見られる（書き足しはできない）
// ・スタッフのホームのお知らせ欄と、カレンダーの日付の詳細に出る

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
const logSize = () => readFileSync("/tmp/nextdev.log").length;
const logSince = (offset) => readFileSync("/tmp/nextdev.log").subarray(offset).toString();

const target = new Date(Date.now() + 9 * 3600e3 + 2 * 86400e3).toISOString().slice(0, 10);
const [ty, tm, td] = target.split("-").map(Number);
const suffix = Date.now();
// パスワード "password123"（psqlはシェル経由なので$をエスケープ）
const PASSWORD_HASH = "\\$2b\\$10\\$/mEEG3MjInUs/GTnDFsVM./2.GDR18u06dgvlLCPnc1Xz2kVQRLga";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const newPage = async () => (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const client = await newPage();
const agency = await newPage();
const staffPage = await newPage();

async function registerCompany(page, person, email, companyName) {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", person);
  await page.fill("#email", email);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  return psql(`select id from "Company" where name='${companyName}';`);
}
async function openDay(page) {
  await page.goto(`http://localhost:3000/company/calendar?y=${ty}&m=${tm}`);
  await page.waitForTimeout(900);
  await page.locator("main button", { has: page.locator(`span:text-is("${td}")`) }).first().click();
  await page.waitForTimeout(500);
  return page.locator("div.fixed.inset-0.z-20").last();
}
function addUser(name, email, companyId) {
  const id = psql(
    `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${email}', '${PASSWORD_HASH}', '${name}', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${id}', '${companyId}', 'STAFF');`);
  return id;
}

try {
  const clientName = `お知らせ依頼主${suffix}`;
  const agencyName = `お知らせ派遣${suffix}`;
  const clientId = await registerCompany(client, "依頼主担当", `ann-client-${suffix}@example.com`, clientName);
  const agencyId = await registerCompany(agency, "派遣担当", `ann-agency-${suffix}@example.com`, agencyName);
  psql(`update "Company" set "agencyEnabled" = true where id = '${agencyId}';`);
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "clientCompanyId", status, "createdAt") values (gen_random_uuid()::text, '${agencyId}', '${agencyId}', '${clientId}', 'ACTIVE', now()) returning id) select id from ins;`,
  );

  const recruitmentId = psql(
    `with ins as (insert into "PublicRecruitment" (id, "companyId", title, date, "startTime", "endTime", "maxEntries", "lockedTee", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${clientId}', 'キャディ', '${target}', '07:00', '15:00', 5, 0, now(), now()) returning id) select id from ins;`,
  );
  const shiftFor = (companyId, staffId, source, rel) =>
    psql(
      `insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "publicRecruitmentId", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', '${source}', ${rel ? `'${rel}'` : "null"}, 'キャディ', '${target}', '07:00', '15:00', false, false, 'CONFIRMED', 'ASSIGN', '${recruitmentId}', now(), now());`,
    );
  // 依頼主の自社スタッフ（プッシュあり）
  const ownStaffId = addUser("自社キャディ", `ann-own-${suffix}@example.com`, clientId);
  const pushEndpoint = `https://push.invalid/ann-${suffix}`;
  psql(
    `insert into "PushSubscription" (id, "userId", endpoint, p256dh, auth) values (gen_random_uuid()::text, '${ownStaffId}', '${pushEndpoint}', 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg');`,
  );
  shiftFor(clientId, ownStaffId, "INHOUSE", null);
  // 派遣会社のスタッフ（プッシュなし→メール）。シフトは派遣会社名義
  const agencyStaffEmail = `ann-agency-staff-${suffix}@example.com`;
  const agencyStaffId = addUser("派遣キャディ", agencyStaffEmail, agencyId);
  shiftFor(agencyId, agencyStaffId, "CLIENT", relId);
  // 応募しただけのスタッフ（プッシュなし→メール）
  const appliedEmail = `ann-applied-${suffix}@example.com`;
  const appliedId = addUser("応募キャディ", appliedEmail, clientId);
  psql(`insert into "RecruitmentEntry" (id, "publicRecruitmentId", "staffUserId", status) values (gen_random_uuid()::text, '${recruitmentId}', '${appliedId}', 'APPLIED');`);

  const noticeCount = (id) => Number(psql(`select count(*) from "StaffNotice" where "staffUserId"='${id}';`));

  // --- 通知しないで追加 ---
  let panel = await openDay(client);
  await panel.getByRole("button", { name: /募集一覧/ }).click();
  await client.waitForTimeout(300);
  await panel.getByRole("button", { name: "＋お知らせを追加" }).click();
  await panel.getByLabel("お知らせの内容").fill("集合場所がクラブハウス裏口に変わりました");
  log("「通知する」は最初はチェックなし", !(await panel.getByLabel(/エントリーしているスタッフに通知する/).isChecked()));
  let offset = logSize();
  await panel.getByRole("button", { name: "追加する", exact: true }).click();
  await client.waitForTimeout(1500);
  let out = logSince(offset);
  log(
    "お知らせが追加され、3名のお知らせ欄に出る（確定・派遣・応募のスタッフ）",
    (await panel.innerText()).includes("3名のお知らせ欄に表示されます") &&
      noticeCount(ownStaffId) === 1 &&
      noticeCount(agencyStaffId) === 1 &&
      noticeCount(appliedId) === 1,
  );
  log("通知しない時はプッシュもメールも送らない", !out.includes(pushEndpoint) && !out.includes(`宛先=${agencyStaffEmail}`));
  log("募集のカードにお知らせが出る", (await panel.innerText()).includes("集合場所がクラブハウス裏口に変わりました"));

  // --- 通知して追加 ---
  await panel.getByRole("button", { name: "＋お知らせを追加" }).click();
  await panel.getByLabel("お知らせの内容").fill("雨の場合はレインウェアを持参してください");
  await panel.getByLabel(/エントリーしているスタッフに通知する/).check();
  offset = logSize();
  await panel.getByRole("button", { name: "追加して通知する" }).click();
  await client.waitForTimeout(2000);
  out = logSince(offset);
  log("通知した時は「3名に通知しました」と出る", (await panel.innerText()).includes("3名に通知しました"));
  log("プッシュを受け取れるスタッフにはプッシュ通知", out.includes(pushEndpoint));
  log(
    "プッシュを受け取れない派遣スタッフ・応募スタッフにはメール",
    out.includes(`宛先=${agencyStaffEmail} 件名=【TeeRA】募集のお知らせ`) && out.includes(`宛先=${appliedEmail} 件名=【TeeRA】募集のお知らせ`),
  );
  log("プッシュを送った人にはメールは送らない", !out.includes(`宛先=ann-own-${suffix}@example.com`));
  log("通知したお知らせには「通知済み」と出る", (await panel.innerText()).includes("通知済み"));

  // --- 派遣会社は見るだけ ---
  panel = await openDay(agency);
  await panel.getByRole("button", { name: "オーダー", exact: true }).click();
  await agency.waitForTimeout(300);
  const agencyText = await panel.innerText();
  log("派遣会社は依頼主のオーダーのお知らせを見られる", agencyText.includes("雨の場合はレインウェアを持参してください"));
  log("派遣会社は書き足せない", (await panel.getByRole("button", { name: "＋お知らせを追加" }).count()) === 0);

  // --- スタッフ側（派遣スタッフ：所属は派遣会社、募集は依頼主のもの）---
  await staffPage.goto("http://localhost:3000/login");
  await staffPage.fill("#email", agencyStaffEmail);
  await staffPage.fill("#password", "password123");
  await staffPage.click("button[type=submit]");
  await staffPage.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000 });
  await staffPage.goto(`http://localhost:3000/staff?y=${ty}&m=${tm}`);
  await staffPage.waitForTimeout(1000);
  log(
    "スタッフのホームのお知らせ欄に出る（所属以外の会社からのお知らせも）",
    (await staffPage.locator("main").innerText()).includes(`【${clientName}`) &&
      (await staffPage.locator("main").innerText()).includes("集合場所がクラブハウス裏口に変わりました"),
  );
  const popup = staffPage.locator("div.fixed.inset-0.z-30");
  if (await popup.count()) {
    await popup.last().getByRole("button", { name: "✕" }).click();
    await staffPage.waitForTimeout(300);
  }
  await staffPage.locator("main button", { has: staffPage.locator(`span:text-is("${td}")`) }).first().click();
  await staffPage.waitForTimeout(500);
  const detail = await staffPage.locator("div.fixed.inset-0.z-20").last().innerText();
  log(
    "カレンダーの日付の詳細にお知らせが出る",
    detail.includes("集合場所がクラブハウス裏口に変わりました") && detail.includes("雨の場合はレインウェアを持参してください"),
  );

  console.log(process.exitCode ? "RECRUITMENT ANNOUNCEMENT SMOKE TEST HAD FAILURES" : "RECRUITMENT ANNOUNCEMENT SMOKE TEST PASSED");
} finally {
  await browser.close();
}
