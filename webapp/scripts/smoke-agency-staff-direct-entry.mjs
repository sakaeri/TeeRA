import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";
import { loginViaEmail } from "./_lib/login.mjs";

// 派遣会社から依頼主に配属されているスタッフが、依頼主のオーダーに自分でエントリーしたとき：
// ・シフトは派遣会社名義（派遣会社がアサインしたときと同じ）で作られ、
//   スタッフ・派遣会社・依頼主のカレンダーすべてに載る
// ・依頼主からは外せない（解除は派遣会社が行う）

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
  const clientName = `直接エントリー依頼主${suffix}`;
  const agencyName = `直接エントリー派遣${suffix}`;
  const clientId = await registerCompany(client, "依頼主担当", `dir-client-${suffix}@example.com`, clientName);
  const agencyId = await registerCompany(agency, "派遣担当", `dir-agency-${suffix}@example.com`, agencyName);
  psql(`update "Company" set "agencyEnabled" = true where id = '${agencyId}';`);
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "clientCompanyId", status, "createdAt") values (gen_random_uuid()::text, '${agencyId}', '${agencyId}', '${clientId}', 'ACTIVE', now()) returning id) select id from ins;`,
  );
  // 派遣会社の所属で、依頼主に配属されているスタッフ
  const staffEmail = `dir-staff-${suffix}@example.com`;
  const staffId = addUser("直接エントリー花子", staffEmail, agencyId);
  psql(`insert into "StaffPlacement" (id, "staffUserId", "companyRelationshipId", active) values (gen_random_uuid()::text, '${staffId}', '${relId}', true);`);
  // 依頼主のオーダー
  const recruitmentId = psql(
    `with ins as (insert into "PublicRecruitment" (id, "companyId", title, date, "startTime", "endTime", "maxEntries", "lockedTee", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${clientId}', 'イベント', '${target}', '07:00', '16:00', 5, 0, now(), now()) returning id) select id from ins;`,
  );

  // スタッフが自分でエントリーする
  await loginViaEmail(staffPage, staffEmail, "password123");
  await staffPage.goto("http://localhost:3000/staff/recruitments");
  const item = staffPage.locator(`[data-testid="recruitment-${recruitmentId}"]`);
  await item.locator("button").first().click();
  await item.getByRole("button", { name: "応募する" }).click();
  await staffPage.locator("div.fixed.inset-0.z-40").getByRole("button", { name: "応募する" }).click();
  await staffPage.waitForTimeout(1200);

  const shift = psql(
    `select "companyId" || '|' || source || '|' || coalesce("companyRelationshipId",'') || '|' || coalesce("taskName",'') from "Shift" where "publicRecruitmentId"='${recruitmentId}' and "staffUserId"='${staffId}' and status='CONFIRMED';`,
  );
  log("派遣スタッフが直接エントリーすると、派遣会社名義のシフトになる", shift === `${agencyId}|CLIENT|${relId}|イベント`);

  // スタッフのカレンダー
  await staffPage.goto(`http://localhost:3000/staff?y=${ty}&m=${tm}`);
  await staffPage.waitForTimeout(1000);
  const popup = staffPage.locator("div.fixed.inset-0.z-30");
  if (await popup.count()) await popup.last().getByRole("button", { name: "✕" }).click().catch(() => {});
  await staffPage.locator("main button", { has: staffPage.locator(`span:text-is("${td}")`) }).first().click();
  await staffPage.waitForTimeout(500);
  log("スタッフのカレンダーに載る", (await staffPage.locator("div.fixed.inset-0.z-20").last().innerText()).includes(clientName));

  // 派遣会社のカレンダー
  let panel = await openDay(agency);
  log("派遣会社のカレンダーに載る", (await panel.innerText()).includes("直接エントリー花子"));

  // 依頼主のカレンダー（派遣会社名付き・依頼主からは外せない）
  panel = await openDay(client);
  const row = panel.locator("li", { hasText: "直接エントリー花子" }).first();
  log("依頼主のカレンダーに「派遣：派遣会社名」付きで載る", (await row.innerText()).includes(`派遣：${agencyName}`));
  log(
    "依頼主からは外せない（×が無く「解除は派遣会社へ」と出る）",
    (await row.getByRole("button", { name: "シフトを解除" }).count()) === 0 && (await row.innerText()).includes("解除は派遣会社へ"),
  );

  console.log(process.exitCode ? "AGENCY STAFF DIRECT ENTRY SMOKE TEST HAD FAILURES" : "AGENCY STAFF DIRECT ENTRY SMOKE TEST PASSED");
} catch (err) {
  console.error("AGENCY STAFF DIRECT ENTRY SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
