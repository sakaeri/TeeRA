import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

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

// チームマネージャー/リーダーは会社レベルのrole自体はSTAFFのまま
// （hasAnyTeamManagementRoleで/company/*への入場だけ特別に許可される）
// なので、canWorkShiftsフラグに関係なく元から/staff・/company両方に
// 入れる。この検証では、両方のシェルの切り替えリンク（「スタッフ画面へ」
// 「会社画面へ」）がチームマネージャー/リーダーにもちゃんと出ることを
// 確認する（元々はcanWorkShiftsの管理者だけが対象で、チームリーダーには
// 出ていなかった不具合の再発防止）。

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const leaderCtx = await browser.newContext();
const leader = await leaderCtx.newPage();

const adminEmail = `tlsw-admin-${Date.now()}@example.com`;
const leaderEmail = `tlsw-leader-${Date.now()}@example.com`;
const companyName = `シェル切替確認株式会社${Date.now()}`;
const leaderName = `シェル切替確認リーダー${Date.now()}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "シェル切替確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  await admin.goto("http://localhost:3000/company/settings?tab=teams");
  await admin.getByRole("button", { name: "＋チームを作成" }).click();
  await admin.waitForTimeout(200);
  {
    const createModal = admin.locator("div.fixed.inset-0.z-30").last();
    await createModal.locator('input[placeholder="新しいチーム名"]').fill("確認チーム");
    await createModal.getByRole("button", { name: "作成", exact: true }).click();
  }
  await admin.waitForTimeout(400);
  const teamId = psql(`select id from "Team" where "companyId"='${companyId}' and name='確認チーム';`);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  await leader.goto(inviteUrl);
  await leader.click("text=アカウントを作成して参加する");
  await leader.fill("#name", leaderName);
  await leader.fill("#email", leaderEmail);
  await leader.fill("#password", "password123");
  await leader.click("button[type=submit]");
  await leader.waitForURL(/\/invite\//, { timeout: 10000 });
  await leader.click("text=参加する");
  await leader.waitForURL("http://localhost:3000/staff", { timeout: 10000 });
  const leaderUserId = psql(`select id from "User" where email='${leaderEmail}';`);
  psql(
    `insert into "TeamMembership" (id, "teamId", "userId", role, "createdAt") ` +
      `values (gen_random_uuid()::text, '${teamId}', '${leaderUserId}', 'TEAM_LEADER', now()) ` +
      `on conflict ("teamId","userId") do update set role='TEAM_LEADER';`,
  );

  const membershipRole = psql(`select role from "CompanyMembership" where "userId"='${leaderUserId}';`);
  log("リーダーの会社レベルroleはSTAFFのまま", membershipRole === "STAFF");

  // --- リーダーは/companyに入れる（hasAnyTeamManagementRoleの例外）---
  await leader.goto("http://localhost:3000/company");
  await leader.waitForTimeout(300);
  log("リーダーは/companyに入れる", leader.url().endsWith("/company"));

  await leader.click('button[aria-label="プロフィールメニュー"]');
  await leader.waitForTimeout(200);
  let menuText = await leader.locator('button[aria-label="プロフィールメニュー"] + div').textContent();
  log("会社画面で「スタッフ画面へ」リンクが表示される", menuText.includes("スタッフ画面へ"));
  await leader.click("text=スタッフ画面へ");
  await leader.waitForURL("http://localhost:3000/staff", { timeout: 10000 });
  log("「スタッフ画面へ」でスタッフ画面に戻れる", leader.url().endsWith("/staff"));

  // --- スタッフ画面側にも「会社画面へ」が出る ---
  await leader.click('button[aria-label="プロフィールメニュー"]');
  await leader.waitForTimeout(200);
  menuText = await leader.locator('button[aria-label="プロフィールメニュー"] + div').textContent();
  log("スタッフ画面で「会社画面へ」リンクが表示される", menuText.includes("会社画面へ"));
  await leader.click("text=会社画面へ");
  await leader.waitForURL("http://localhost:3000/company", { timeout: 10000 });
  log("「会社画面へ」で会社画面に戻れる", leader.url().endsWith("/company"));

  console.log(process.exitCode ? "TEAM LEAD SHELL SWITCH SMOKE TEST HAD FAILURES" : "TEAM LEAD SHELL SWITCH SMOKE TEST PASSED");
} catch (err) {
  console.error("TEAM LEAD SHELL SWITCH SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-team-lead-shell-switch-admin-failure.png" });
  await leader.screenshot({ path: "/tmp/smoke-team-lead-shell-switch-leader-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
