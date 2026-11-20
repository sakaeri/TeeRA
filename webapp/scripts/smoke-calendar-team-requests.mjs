import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";
import { loginViaEmail } from "./_lib/login.mjs";

// カレンダーをチームで絞り込んだ時、シフト希望（出勤・休み）はそのチームのスタッフの分だけ出す
// ・本部がAチームで絞り込むと、Bチームのスタッフの休み希望は出ない
// ・Aチームのマネージャーには、もともとAチームのスタッフの分だけ

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
const admin = await (await browser.newContext()).newPage();
const manager = await (await browser.newContext()).newPage();
const suffix = Date.now();

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "チーム希望本部");
  await admin.fill("#email", `teamreq-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", `チーム希望確認株式会社${suffix}`);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='チーム希望確認株式会社${suffix}';`);

  const team = (name) => psql(`insert into "Team" (id, "companyId", name) values (gen_random_uuid()::text, '${companyId}', '${name}') returning id;`);
  const user = (name, email) =>
    psql(`insert into "User" (id, email, name, "emailVerified", "updatedAt") values (gen_random_uuid()::text, '${email}', '${name}', true, now()) returning id;`);
  const member = (userId, teamId, role = "TEAM_MEMBER") => {
    psql(`insert into "CompanyMembership" (id, "userId", "companyId", role, "canWorkShifts") values (gen_random_uuid()::text, '${userId}', '${companyId}', 'STAFF', true) on conflict do nothing;`);
    psql(`insert into "TeamMembership" (id, "teamId", "userId", role) values (gen_random_uuid()::text, '${teamId}', '${userId}', '${role}');`);
  };
  const teamA = team("Aチーム");
  const teamB = team("Bチーム");
  const managerEmail = `teamreq-manager-${suffix}@example.com`;
  const managerId = user("Aマネージャー", managerEmail);
  member(managerId, teamA, "TEAM_MANAGER");
  const staffA = user("Aチームの花子", `teamreq-a-${suffix}@example.com`);
  member(staffA, teamA);
  const staffB = user("Bチームの太郎", `teamreq-b-${suffix}@example.com`);
  member(staffB, teamB);

  const date = psql(`select ((now() at time zone 'Asia/Tokyo')::date + 3)::text;`);
  const [y, m, d] = date.split("-").map(Number);
  for (const [sid, tid] of [[staffA, teamA], [staffB, teamB]]) {
    psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", "teamId", desire, dates, status) values (gen_random_uuid()::text, '${sid}', '${companyId}', '${tid}', 'OFF', ARRAY['${date}'::date], 'PENDING');`);
  }

  const dayText = async (page, query) => {
    await page.goto(`http://localhost:3000/company/calendar?y=${y}&m=${m}${query}`);
    await page.waitForTimeout(800);
    await page.locator(`button:has(> span:text-is("${d}"))`).first().click();
    const popup = page.getByTestId("day-detail-popup");
    await popup.waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
    return popup.innerText();
  };

  const all = await dayText(admin, "");
  log("絞り込みなしでは両方のチームの休み希望が出る", all.includes("Aチームの花子") && all.includes("Bチームの太郎"));
  const onlyA = await dayText(admin, `&team=${teamA}`);
  log("Aチームで絞り込むと、Aチームのスタッフの休み希望だけ出る", onlyA.includes("Aチームの花子") && !onlyA.includes("Bチームの太郎"));

  await loginViaEmail(manager, managerEmail);
  const mgr = await dayText(manager, "");
  log("Aチームのマネージャーには、Aチームのスタッフの休み希望だけ出る", mgr.includes("Aチームの花子") && !mgr.includes("Bチームの太郎"));

  console.log(process.exitCode ? "CALENDAR TEAM REQUESTS SMOKE TEST HAD FAILURES" : "CALENDAR TEAM REQUESTS SMOKE TEST PASSED");
} catch (err) {
  console.error("CALENDAR TEAM REQUESTS SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
