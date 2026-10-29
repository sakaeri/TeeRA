import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// シフトの三者共有（派遣会社・スタッフ・依頼主）を検証する：
// ・派遣会社が依頼主の現場に入れたシフトが、依頼主のカレンダーにも「派遣：◯◯」付きで出る
// ・依頼主の募集の「確定スタッフ」に、派遣会社が入れた人の名前が出る
// ・依頼主も出勤時間を入力・変更でき、スタッフ本人と派遣会社の両方に知らせる
// ・依頼主からは派遣会社のシフトを解除できない（解除ボタンが出ない）
// ・派遣会社側のカレンダーは今まで通り（解除もできる）
// ・関係のない会社には出ない

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

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const newPage = async () => (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const client = await newPage();
const agency = await newPage();
const outsider = await newPage();

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

try {
  const clientName = `三者依頼主ゴルフ${suffix}`;
  const agencyName = `三者派遣株式会社${suffix}`;
  const clientCompanyId = await registerCompany(client, "依頼主担当", `tri-client-${suffix}@example.com`, clientName);
  const agencyCompanyId = await registerCompany(agency, "派遣担当", `tri-agency-${suffix}@example.com`, agencyName);
  await registerCompany(outsider, "関係ない担当", `tri-outsider-${suffix}@example.com`, `三者関係ない${suffix}`);
  const agencyNotifyEmail = `tri-agency-notify-${suffix}@example.com`;
  psql(`update "Company" set "agencyEnabled" = true, "notificationEmail"='${agencyNotifyEmail}' where id = '${agencyCompanyId}';`);
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "clientCompanyId", status, "createdAt") values (gen_random_uuid()::text, '${agencyCompanyId}', '${agencyCompanyId}', '${clientCompanyId}', 'ACTIVE', now()) returning id) select id from ins;`,
  );

  // 派遣会社のスタッフ（届かない宛先のプッシュ購読つき）
  const staffId = psql(
    `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'tri-staff-${suffix}@example.com', 'x', '派遣キャディ花子', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${agencyCompanyId}', 'STAFF');`);
  const pushEndpoint = `https://push.invalid/tri-${suffix}`;
  psql(
    `insert into "PushSubscription" (id, "userId", endpoint, p256dh, auth) values (gen_random_uuid()::text, '${staffId}', '${pushEndpoint}', 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg');`,
  );

  // 依頼主の募集（オーダー）に、派遣会社がスタッフを入れた（シフトは派遣会社名義）
  const recruitmentId = psql(
    `with ins as (insert into "PublicRecruitment" (id, "companyId", title, date, "isUndecided", "maxEntries", "lockedTee", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${clientCompanyId}', 'キャディ', '${target}', true, 5, 0, now(), now()) returning id) select id from ins;`,
  );
  const shiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "publicRecruitmentId", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${agencyCompanyId}', '${staffId}', 'CLIENT', '${relId}', 'キャディ', '${target}', null, null, false, true, 'CONFIRMED', 'ASSIGN', '${recruitmentId}', now(), now()) returning id) select id from ins;`,
  );

  // --- 依頼主のカレンダー ---
  let panel = await openDay(client);
  const row = panel.locator("li", { hasText: "派遣キャディ花子" }).first();
  log("派遣会社が入れたシフトが依頼主のカレンダーに出る", (await row.count()) === 1);
  log("「派遣：派遣会社名」のラベルが付く", (await row.innerText()).includes(`派遣：${agencyName}`));
  log("依頼主からは解除できない（解除ボタンが出ない）", (await row.getByRole("button", { name: "シフトを解除" }).count()) === 0);
  await panel.getByRole("button", { name: /募集一覧/ }).click();
  await client.waitForTimeout(300);
  if (!(await panel.innerText()).includes("派遣キャディ花子")) {
    await panel.getByRole("button", { name: /確定スタッフ（1名）/ }).click();
    await client.waitForTimeout(300);
  }
  const recruitText = await panel.innerText();
  log(
    "依頼主の募集の確定スタッフに、派遣会社が入れた人の名前と派遣会社名が出る",
    recruitText.includes("派遣キャディ花子") && recruitText.includes(`派遣：${agencyName}`),
  );
  await panel.getByRole("button", { name: "スタッフシフト" }).click();
  await client.waitForTimeout(300);

  // 依頼主が出勤時間を入力
  await row.getByTitle("出勤時間を入力・変更").click();
  const modal = client.locator("div.fixed.inset-0.z-20").last();
  await modal.getByText("時間を指定", { exact: true }).click();
  await modal.locator('input[type="time"]').nth(0).fill("07:00");
  await modal.locator('input[type="time"]').nth(1).fill("15:00");
  const offset = logSize();
  await modal.getByRole("button", { name: "保存して通知する" }).click();
  await client.waitForTimeout(1800);
  const out = logSince(offset);
  log(
    "依頼主も出勤時間を入力できる",
    psql(`select coalesce("startTime",'') || '-' || coalesce("endTime",'') || '-' || "isUndecided"::text from "Shift" where id='${shiftId}';`) ===
      "07:00-15:00-false",
  );
  log("スタッフ本人にプッシュ通知を送る", out.includes(pushEndpoint));
  log(
    "派遣会社に「依頼主が出勤時間を変更しました」と知らせる",
    out.includes(`宛先=${agencyNotifyEmail} 件名=【TeeRA】依頼主が出勤時間を変更しました`),
  );

  // --- 派遣会社のカレンダー（今まで通り）---
  panel = await openDay(agency);
  const agencyRow = panel.locator("li", { hasText: "派遣キャディ花子" }).first();
  log("派遣会社のカレンダーにも新しい時間で出る", (await agencyRow.innerText()).includes("07:00〜15:00"));
  log("派遣会社のラベルは勤務先（依頼主名）のまま", (await agencyRow.innerText()).includes(clientName));
  log("派遣会社は今まで通り解除できる", (await agencyRow.getByRole("button", { name: "シフトを解除" }).count()) === 1);

  // --- 関係のない会社 ---
  await outsider.goto(`http://localhost:3000/company/calendar?y=${ty}&m=${tm}`);
  await outsider.waitForTimeout(900);
  log("関係のない会社のカレンダーには出ない", !(await outsider.locator("main").innerText()).includes("派遣キャディ花子"));

  console.log(process.exitCode ? "CLIENT SEES AGENCY SHIFTS SMOKE TEST HAD FAILURES" : "CLIENT SEES AGENCY SHIFTS SMOKE TEST PASSED");
} finally {
  await browser.close();
}
