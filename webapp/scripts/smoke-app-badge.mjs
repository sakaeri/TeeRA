import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";
import { loginViaEmail } from "./_lib/login.mjs";

// アプリのアイコンの数字（/api/app-badge）と、マネージャーのダッシュボードの件数：
// ・本部の管理者は会社全体、チームのマネージャーは自分のチームの分だけ数える
// ・マネージャー兼スタッフは、スタッフとしての件数（未読のお知らせなど）も足される
// ・マネージャーのダッシュボードの「未確定シフト」も自分のチームの分だけ

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
const badge = async (page) => (await (await page.request.get("http://localhost:3000/api/app-badge")).json()).count;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "バッジ本部");
  await admin.fill("#email", `badge-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", `バッジ確認株式会社${suffix}`);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='バッジ確認株式会社${suffix}';`);

  const team = (name) =>
    psql(`insert into "Team" (id, "companyId", name) values (gen_random_uuid()::text, '${companyId}', '${name}') returning id;`);
  const user = (name, email) =>
    psql(`insert into "User" (id, email, name, "emailVerified", "updatedAt") values (gen_random_uuid()::text, '${email}', '${name}', true, now()) returning id;`);
  const teamA = team("Aチーム");
  const teamB = team("Bチーム");
  const managerEmail = `badge-manager-${suffix}@example.com`;
  const managerId = user("Aマネージャー", managerEmail);
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role, "canWorkShifts") values (gen_random_uuid()::text, '${managerId}', '${companyId}', 'STAFF', true);`);
  psql(`insert into "TeamMembership" (id, "teamId", "userId", role) values (gen_random_uuid()::text, '${teamA}', '${managerId}', 'TEAM_MANAGER');`);
  const staffB = user("Bスタッフ", `badge-staffb-${suffix}@example.com`);
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffB}', '${companyId}', 'STAFF');`);
  psql(`insert into "TeamMembership" (id, "teamId", "userId", role) values (gen_random_uuid()::text, '${teamB}', '${staffB}', 'TEAM_MEMBER');`);

  await loginViaEmail(manager, managerEmail);
  const admin0 = await badge(admin);
  const manager0 = await badge(manager);

  const shiftRequest = (staffId, teamId) =>
    psql(
      `insert into "ShiftRequest" (id, "staffUserId", "companyId", "teamId", desire, dates, status) values (gen_random_uuid()::text, '${staffId}', '${companyId}', '${teamId}', 'WORK', ARRAY[current_date + 3]::date[], 'PENDING');`,
    );

  // Bチームの出勤希望：本部だけ増え、Aチームのマネージャーは増えない
  shiftRequest(staffB, teamB);
  log("Bチームの未確定シフトで、本部の数字は1増える", (await badge(admin)) === admin0 + 1);
  log("Bチームの未確定シフトでは、Aチームのマネージャーの数字は増えない", (await badge(manager)) === manager0);

  // Aチームの出勤希望（マネージャー本人の希望）：両方増える
  shiftRequest(managerId, teamA);
  log("Aチームの未確定シフトで、本部の数字は1増える", (await badge(admin)) === admin0 + 2);
  log("Aチームの未確定シフトで、Aチームのマネージャーの数字も1増える", (await badge(manager)) === manager0 + 1);

  // マネージャー本人宛ての未読のお知らせ（スタッフとしての件数）も足される
  const noticeId = psql(
    `insert into "StaffNotice" (id, "companyId", "staffUserId", message) values (gen_random_uuid()::text, '${companyId}', '${managerId}', '確認用のお知らせ') returning id;`,
  );
  log("マネージャー兼スタッフは、未読のお知らせも足される", (await badge(manager)) === manager0 + 2);
  log("本部の数字は、ほかの人宛てのお知らせでは増えない", (await badge(admin)) === admin0 + 2);
  psql(`update "StaffNotice" set "readAt"=now() where id='${noticeId}';`);
  log("お知らせを読むと数字が減る", (await badge(manager)) === manager0 + 1);

  // 契約書の未送付など、長く残るものはアイコンの数字に入れない（未確定シフト・業務報告の未承認だけ）
  const noContract = user("契約書なしスタッフ", `badge-nocontract-${suffix}@example.com`);
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${noContract}', '${companyId}', 'STAFF');`);
  log("契約書が未送付のスタッフが増えても、本部の数字は増えない", (await badge(admin)) === admin0 + 2);

  // やることリストは、チームごとに「未確定のシフト希望が◯件あります（チーム名）」の1行
  await admin.goto("http://localhost:3000/company");
  const todoText = await admin.locator("main").innerText();
  log("やることリストの未確定シフトはチームごとに1行にまとまる", todoText.includes("未確定のシフト希望が1件あります（Aチーム）") && todoText.includes("未確定のシフト希望が1件あります（Bチーム）"));
  await admin.getByRole("link", { name: /未確定のシフト希望が1件あります（Bチーム）/ }).click();
  await admin.getByText("スタッフから提出された希望シフトです").waitFor({ timeout: 15000 });
  const popupText = await admin.locator("div.fixed.inset-0").last().innerText();
  log("タップするとそのチームの未確定シフトだけの一覧が開く", popupText.includes("Bスタッフ") && !popupText.includes("マネージャー"));

  // マネージャーのダッシュボードの「未確定シフト」は自分のチームの分だけ
  await manager.goto("http://localhost:3000/company");
  const card = manager.locator("button, a", { hasText: "未確定シフト" }).first();
  await card.waitFor();
  log("マネージャーのダッシュボードの未確定シフトは自分のチームの1件だけ", (await card.innerText()).replace(/\s/g, "").includes("未確定シフト1"));
  await admin.goto("http://localhost:3000/company");
  const adminCard = admin.locator("button, a", { hasText: "未確定シフト" }).first();
  log("本部のダッシュボードの未確定シフトは会社全体の2件", (await adminCard.innerText()).replace(/\s/g, "").includes("未確定シフト2"));

  // ログインしていなければ数えない
  const anon = await (await browser.newContext()).newPage();
  log("ログインしていなければ401", (await anon.request.get("http://localhost:3000/api/app-badge")).status() === 401);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(process.exitCode ? "APP BADGE SMOKE TEST FAILED" : "APP BADGE SMOKE TEST PASSED");
