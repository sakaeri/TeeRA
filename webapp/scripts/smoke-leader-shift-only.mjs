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
const leaderCtx = await browser.newContext();
const leader = await leaderCtx.newPage();

const adminEmail = `leader-admin-${Date.now()}@example.com`;
const leaderEmail = `leader-mgr-${Date.now()}@example.com`;
const thisMonth = new Date().toISOString().slice(0, 7);

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "リーダー確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "リーダー確認株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='リーダー確認株式会社' order by "createdAt" desc limit 1;`);

  await admin.goto("http://localhost:3000/company/settings?tab=teams");
  await admin.fill('input[placeholder="新しいチーム名"]', "Aチーム");
  await admin.getByRole("button", { name: "＋チームを作成" }).click();
  await admin.waitForTimeout(400);
  const teamAId = psql(`select id from "Team" where "companyId"='${companyId}' and name='Aチーム';`);

  // Aチームのリーダーを招待
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  await leader.goto(inviteUrl);
  await leader.click("text=アカウントを作成して参加する");
  await leader.fill("#name", "Aチームリーダー");
  await leader.fill("#email", leaderEmail);
  await leader.fill("#password", "password123");
  await leader.click("button[type=submit]");
  await leader.waitForURL(new RegExp("/invite/"));
  await leader.click("text=参加する");
  await leader.waitForURL("http://localhost:3000/staff");
  const leaderUserId = psql(`select id from "User" where email='${leaderEmail}';`);
  psql(`insert into "TeamMembership" (id, "teamId", "userId", role, "createdAt") values (gen_random_uuid()::text, '${teamAId}', '${leaderUserId}', 'TEAM_LEADER', now()) on conflict ("teamId","userId") do update set role='TEAM_LEADER';`);

  // シフトを受け取る一般スタッフ
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "Aチームスタッフ");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(500);
  const plainStaffId = psql(`select id from "User" where name='Aチームスタッフ' order by "createdAt" desc limit 1;`);
  psql(`insert into "TeamMembership" (id, "teamId", "userId", role, "createdAt") values (gen_random_uuid()::text, '${teamAId}', '${plainStaffId}', 'TEAM_MEMBER', now()) on conflict ("teamId","userId") do update set role='TEAM_MEMBER';`);

  // --- リーダーはシフトを作成できる ---
  await leader.goto("http://localhost:3000/company/calendar");
  await leader.locator("button", { hasText: "＋" }).last().click();
  await leader.getByText("シフトを作成").click();
  const modal = leader.locator("div.fixed.inset-0.z-20").last();
  if (await modal.getByText("どのチームのシフトを作成しますか？").count()) {
    await modal.getByRole("button", { name: /^Aチーム/ }).click();
    await leader.waitForTimeout(200);
  }
  await modal.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await modal.getByRole("button", { name: "＋ 新しい業務内容を追加する" }).click();
  await modal.locator('input[placeholder*="業務内容"]').fill("リーダー確認業務");
  await modal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await leader.waitForTimeout(300);
  await modal.getByRole("button", { name: "Aチームスタッフ" }).click();
  await modal.getByRole("button", { name: "次へ" }).click();
  await leader.waitForTimeout(300);
  await modal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await leader.waitForTimeout(800);

  const shiftCount = psql(`select count(*) from "Shift" where "staffUserId"='${plainStaffId}' and "taskName"='リーダー確認業務';`);
  log("リーダーがシフトを作成できる", shiftCount === "1");

  // --- リーダーは給与計算・請求書・契約書に触れない ---
  await leader.goto(`http://localhost:3000/company/payroll?month=${thisMonth}&staff=${plainStaffId}`);
  await leader.waitForTimeout(500);
  let body = await leader.textContent("body");
  log("リーダーは給与計算を閲覧できない", body.includes("対象月とスタッフを選択してください") && !body.includes("勤務内訳"));

  // --- 派遣会社詳細にはチーム編集セクションが出ない（依頼主のみ）---
  await admin.goto("http://localhost:3000/company/roster");
  const companyForAgency = psql(`update "Company" set "dispatchEnabled" = true where id='${companyId}' returning id;`);
  log("dispatchEnabled有効化", Boolean(companyForAgency));
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=派遣会社一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋派遣会社を追加する");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "確認用派遣会社");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=派遣会社一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=確認用派遣会社");
  await admin.waitForTimeout(300);
  const agencyPanel = admin.locator("div.fixed.inset-0.z-30").last();
  body = await agencyPanel.textContent();
  log("派遣会社詳細にはチーム編集ボタンが出ない", !body.includes("チームとの紐付けを編集"));

  console.log(process.exitCode ? "LEADER SHIFT-ONLY SMOKE TEST HAD FAILURES" : "LEADER SHIFT-ONLY SMOKE TEST PASSED");
} catch (err) {
  console.error("LEADER SHIFT-ONLY SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-leader-shift-only-admin-failure.png" });
  await leader.screenshot({ path: "/tmp/smoke-leader-shift-only-leader-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
