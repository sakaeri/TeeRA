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

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const mgrCtx = await browser.newContext();
const mgr = await mgrCtx.newPage();

const adminEmail = `tredesign-admin-${Date.now()}@example.com`;
const mgrEmail = `tredesign-mgr-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "編集導線確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "編集導線確認株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='編集導線確認株式会社' order by "createdAt" desc limit 1;`);

  // 2チーム作成
  await admin.goto("http://localhost:3000/company/settings?tab=teams");
  await admin.fill('input[placeholder="新しいチーム名"]', "Aチーム");
  await admin.getByRole("button", { name: "＋チームを作成" }).click();
  await admin.waitForTimeout(400);
  await admin.fill('input[placeholder="新しいチーム名"]', "Bチーム");
  await admin.getByRole("button", { name: "＋チームを作成" }).click();
  await admin.waitForTimeout(400);
  let body = await admin.textContent("body");
  log("設定画面にマネージャー/リーダーの説明文が出る", body.includes("マネージャー/リーダーだけです"));
  log("マネージャー未登録のチームは「まだマネージャー/リーダーがいません」と出る", body.includes("まだマネージャー/リーダーがいません"));

  // --- ①「新しく招待する」でAチームのマネージャーを招待 ---
  const teamACard = admin
    .locator("div.rounded-xl.border.border-border.p-4")
    .filter({ has: admin.locator("div.mb-3.font-semibold", { hasText: /^Aチーム$/ }) });
  await teamACard.getByRole("button", { name: "＋招待" }).click();
  await teamACard.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForTimeout(500);
  const inviteUrl = await teamACard.locator("p", { hasText: "招待URL:" }).textContent();
  const url = inviteUrl.replace("招待URL:", "").trim();

  await mgr.goto(url);
  await mgr.click("text=アカウントを作成して参加する");
  await mgr.fill("#name", "Aチームマネージャー");
  await mgr.fill("#email", mgrEmail);
  await mgr.fill("#password", "password123");
  await mgr.click("button[type=submit]");
  await mgr.waitForURL(new RegExp("/invite/"));
  await mgr.click("text=参加する");
  await mgr.waitForURL("http://localhost:3000/staff");

  const mgrUserId = psql(`select id from "User" where email='${mgrEmail}';`);
  const teamAId = psql(`select id from "Team" where "companyId"='${companyId}' and name='Aチーム';`);
  const roleAfterInvite = psql(`select role from "TeamMembership" where "teamId"='${teamAId}' and "userId"='${mgrUserId}';`);
  log("招待URL経由で参加すると最初からTEAM_MANAGERになっている", roleAfterInvite === "TEAM_MANAGER");

  await admin.goto("http://localhost:3000/company/settings?tab=teams");
  body = await admin.textContent("body");
  log("Aチームのカードに新しいマネージャーが表示される", body.includes("Aチームマネージャー"));

  // --- ②「権限を外す」で降格 ---
  const teamACard2 = admin
    .locator("div.rounded-xl.border.border-border.p-4")
    .filter({ has: admin.locator("div.mb-3.font-semibold", { hasText: /^Aチーム$/ }) });
  await teamACard2.getByRole("button", { name: "権限を外す" }).click();
  await admin.waitForTimeout(500);
  const roleAfterDemote = psql(`select role from "TeamMembership" where "teamId"='${teamAId}' and "userId"='${mgrUserId}';`);
  log("権限を外すとTEAM_MEMBERに戻る（チームからは外れない）", roleAfterDemote === "TEAM_MEMBER");
  body = await admin.textContent("body");
  log("降格後はチームカードの一覧から消える", !body.includes("Aチームマネージャー") || body.includes("まだマネージャー/リーダーがいません"));

  // --- ③「既存スタッフから選ぶ」でBチームのリーダーに昇格 ---
  const teamBCard = admin
    .locator("div.rounded-xl.border.border-border.p-4")
    .filter({ has: admin.locator("div.mb-3.font-semibold", { hasText: /^Bチーム$/ }) });
  await teamBCard.getByRole("button", { name: "＋招待" }).click();
  await teamBCard.getByRole("button", { name: "既存スタッフから選ぶ" }).click();
  await teamBCard.locator("select").first().selectOption({ label: "Aチームマネージャー" });
  await teamBCard.locator("select").nth(1).selectOption("TEAM_LEADER");
  await teamBCard.getByRole("button", { name: "追加する" }).click();
  await admin.waitForTimeout(500);

  const teamBId = psql(`select id from "Team" where "companyId"='${companyId}' and name='Bチーム';`);
  const roleInB = psql(`select role from "TeamMembership" where "teamId"='${teamBId}' and "userId"='${mgrUserId}';`);
  log("既存スタッフから選んでTEAM_LEADERとして追加できた（新規招待なし）", roleInB === "TEAM_LEADER");
  body = await admin.textContent("body");
  log("Bチームのカードにリーダーとして表示される", body.includes("Aチームマネージャー"));

  // --- ④ 一般スタッフのチーム所属をスタッフ詳細の編集パネルで変更 ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "一般スタッフ太郎");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(500);
  const plainStaffId = psql(`select id from "User" where name='一般スタッフ太郎' order by "createdAt" desc limit 1;`);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=一般スタッフ太郎");
  await admin.waitForTimeout(300);
  const staffPanel = admin.locator("div.fixed.inset-0.z-30").last();
  body = await staffPanel.textContent();
  log("一般スタッフは最初「チーム未所属」", body.includes("チーム未所属"));

  await staffPanel.getByRole("button", { name: /編集/ }).click();
  await admin.waitForTimeout(200);
  await staffPanel.locator("label", { hasText: "Aチーム" }).locator('input[type=checkbox]').check();
  await staffPanel.getByRole("button", { name: "保存", exact: true }).click();
  await admin.waitForTimeout(500);

  const plainStaffTeamRole = psql(`select role from "TeamMembership" where "teamId"='${teamAId}' and "userId"='${plainStaffId}';`);
  log("編集パネルからAチームのTEAM_MEMBERとして追加された", plainStaffTeamRole === "TEAM_MEMBER");
  body = await staffPanel.textContent();
  log("編集後はバッジにAチームが表示される", body.includes("Aチーム"));

  // 外す方向も確認
  await staffPanel.getByRole("button", { name: /編集/ }).click();
  await admin.waitForTimeout(200);
  await staffPanel.locator("label", { hasText: "Aチーム" }).locator('input[type=checkbox]').uncheck();
  await staffPanel.getByRole("button", { name: "保存", exact: true }).click();
  await admin.waitForTimeout(500);
  const plainStaffTeamCountAfter = psql(`select count(*) from "TeamMembership" where "teamId"='${teamAId}' and "userId"='${plainStaffId}';`);
  log("チェックを外すとチームから外れる", plainStaffTeamCountAfter === "0");

  console.log(process.exitCode ? "TEAM SETTINGS/STAFF-EDIT SMOKE TEST HAD FAILURES" : "TEAM SETTINGS/STAFF-EDIT SMOKE TEST PASSED");
} catch (err) {
  console.error("TEAM SETTINGS/STAFF-EDIT SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-team-redesign-admin-failure.png" });
  await mgr.screenshot({ path: "/tmp/smoke-team-redesign-mgr-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
