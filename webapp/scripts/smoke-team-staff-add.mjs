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

// フェーズ①の本修正の検証: ロースターの「＋スタッフを追加する」がteamId
// を渡していなかったため、チームマネージャーがクリックすると必ず
// forbiddenでクラッシュしていた不具合を、追加モーダルにチーム選択を
// 組み込むことで解消した。ここでは2チームを管理するマネージャーで
// 「選ばせる」パスを、本部管理者で「今まで通り無選択で動く」パスを、
// それぞれ検証する。

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const managerCtx = await browser.newContext();
const manager = await managerCtx.newPage();
const newStaffCtx = await browser.newContext();
const newStaff = await newStaffCtx.newPage();

const adminEmail = `tsa-admin-${Date.now()}@example.com`;
const managerEmail = `tsa-manager-${Date.now()}@example.com`;
const newStaffEmail = `tsa-newstaff-${Date.now()}@example.com`;
const companyName = `チーム追加確認株式会社${Date.now()}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "チーム追加確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  // --- 2チーム作成 ---
  await admin.goto("http://localhost:3000/company/settings?tab=teams");
  for (const name of ["Aチーム", "Bチーム"]) {
    await admin.getByRole("button", { name: "＋チームを作成" }).click();
    await admin.waitForTimeout(200);
    const createModal = admin.locator("div.fixed.inset-0.z-30").last();
    await createModal.locator('input[placeholder="新しいチーム名"]').fill(name);
    await createModal.getByRole("button", { name: "作成", exact: true }).click();
    await admin.waitForTimeout(400);
  }
  const teamAId = psql(`select id from "Team" where "companyId"='${companyId}' and name='Aチーム';`);
  const teamBId = psql(`select id from "Team" where "companyId"='${companyId}' and name='Bチーム';`);

  // --- マネージャーを招待し、両チームのマネージャーにする ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const managerInviteUrl = await admin.locator('input[readonly]').inputValue();
  await manager.goto(managerInviteUrl);
  await manager.click("text=アカウントを作成して参加する");
  await manager.fill("#name", "両チームマネージャー");
  await manager.fill("#email", managerEmail);
  await manager.fill("#password", "password123");
  await manager.click("button[type=submit]");
  await manager.waitForURL(/\/invite\//, { timeout: 10000 });
  await manager.click("text=参加する");
  await manager.waitForURL("http://localhost:3000/staff", { timeout: 10000 });
  const managerUserId = psql(`select id from "User" where email='${managerEmail}';`);
  psql(
    `insert into "TeamMembership" (id, "teamId", "userId", role, "createdAt") ` +
      `values (gen_random_uuid()::text, '${teamAId}', '${managerUserId}', 'TEAM_MANAGER', now()) ` +
      `on conflict ("teamId","userId") do update set role='TEAM_MANAGER';`,
  );
  psql(
    `insert into "TeamMembership" (id, "teamId", "userId", role, "createdAt") ` +
      `values (gen_random_uuid()::text, '${teamBId}', '${managerUserId}', 'TEAM_MANAGER', now()) ` +
      `on conflict ("teamId","userId") do update set role='TEAM_MANAGER';`,
  );

  // --- マネージャーが依頼主/派遣会社タブでは「追加」ボタンが出ない ---
  await manager.goto("http://localhost:3000/company/roster");
  await manager.click("text=依頼主一覧");
  await manager.waitForTimeout(200);
  let managerBody = await manager.textContent("main");
  log("マネージャーには依頼主の追加ボタンが出ない（会社全体の資産のため）", !managerBody.includes("＋依頼主を追加する"));

  // --- マネージャーが仮アカウントを作成: チーム選択が必須で出る ---
  await manager.click("text=スタッフ一覧");
  await manager.waitForTimeout(200);
  await manager.click("text=＋スタッフを追加する");
  await manager.click("text=仮アカウントを作成");
  await manager.waitForTimeout(200);
  let modalText = await manager.textContent("body");
  log("2チーム管理時はチーム選択欄が出る", modalText.includes("どのチームに追加しますか"));

  const createButton = manager.getByRole("button", { name: "作成", exact: true });
  await manager.fill('input[placeholder="名称を入力"]', "B所属仮アカウント");
  log("チーム未選択のうちは作成ボタンが無効", await createButton.isDisabled());

  await manager.locator("select").last().selectOption({ label: "Bチーム" });
  await createButton.click();
  await manager.waitForTimeout(600);
  const proxyStaffId = psql(`select id from "User" where name='B所属仮アカウント' order by "createdAt" desc limit 1;`);
  log("チームマネージャーが仮アカウントを作成できた（forbiddenにならない）", Boolean(proxyStaffId));

  const proxyTeamRow = psql(
    `select "teamId" from "TeamMembership" where "userId"='${proxyStaffId}';`,
  );
  log("選んだ通りBチームに所属している", proxyTeamRow === teamBId);

  // --- マネージャーが本アカウント招待: チーム選択→Aチームで招待→redeem ---
  await manager.goto("http://localhost:3000/company/roster");
  await manager.click("text=＋スタッフを追加する");
  await manager.click("text=本アカウントを招待");
  await manager.waitForTimeout(200);
  modalText = await manager.textContent("body");
  log("招待モーダルにもチーム選択欄が出る", modalText.includes("どのチームに追加しますか"));

  const issueButton = manager.getByRole("button", { name: "招待URLを発行する" });
  log("チーム未選択のうちは招待URL発行ボタンが無効", await issueButton.isDisabled());
  await manager.locator("select").last().selectOption({ label: "Aチーム" });
  await issueButton.click();
  await manager.waitForSelector('input[readonly]');
  const newStaffInviteUrl = await manager.locator('input[readonly]').inputValue();

  await newStaff.goto(newStaffInviteUrl);
  await newStaff.click("text=アカウントを作成して参加する");
  await newStaff.fill("#name", "A所属新規スタッフ");
  await newStaff.fill("#email", newStaffEmail);
  await newStaff.fill("#password", "password123");
  await newStaff.click("button[type=submit]");
  await newStaff.waitForURL(/\/invite\//, { timeout: 10000 });
  await newStaff.click("text=参加する");
  await newStaff.waitForURL("http://localhost:3000/staff", { timeout: 10000 });
  const newStaffUserId = psql(`select id from "User" where email='${newStaffEmail}';`);
  log(
    "チームマネージャーが発行した招待でも本登録できた（forbiddenにならない）",
    Boolean(newStaffUserId),
  );
  const newStaffTeamRow = psql(`select "teamId" from "TeamMembership" where "userId"='${newStaffUserId}';`);
  log("選んだ通りAチームに所属している", newStaffTeamRow === teamAId);

  // --- 本部管理者は今まで通りチーム選択なしで動く（回帰確認） ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=仮アカウントを作成");
  await admin.waitForTimeout(200);
  const adminModalText = await admin.textContent("body");
  log("本部管理者にはチーム選択欄が出ない（今まで通り）", !adminModalText.includes("どのチームに追加しますか"));
  await admin.fill('input[placeholder="名称を入力"]', "管理者作成仮アカウント");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);
  const adminProxyId = psql(`select id from "User" where name='管理者作成仮アカウント' order by "createdAt" desc limit 1;`);
  log("本部管理者は引き続き仮アカウントを作成できる", Boolean(adminProxyId));
  const adminProxyTeamCount = Number(
    psql(`select count(*) from "TeamMembership" where "userId"='${adminProxyId}';`),
  );
  log("本部管理者が作った仮アカウントはチーム未所属のまま（今まで通り）", adminProxyTeamCount === 0);

  console.log(process.exitCode ? "TEAM STAFF ADD SMOKE TEST HAD FAILURES" : "TEAM STAFF ADD SMOKE TEST PASSED");
} catch (err) {
  console.error("TEAM STAFF ADD SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-tsa-admin-failure.png" });
  await manager.screenshot({ path: "/tmp/smoke-tsa-manager-failure.png" });
  await newStaff.screenshot({ path: "/tmp/smoke-tsa-newstaff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
