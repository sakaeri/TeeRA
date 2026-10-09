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
const admin = await (await browser.newContext()).newPage();
const adminEmail = `shift-sort-admin-${Date.now()}@example.com`;
const companyName = `並び順株式会社${Date.now()}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "並び順太郎");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  // 先にチームに属さない一般スタッフを作る（＝並び順の最後に残るはず）
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "無所属スタッフ");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(800);

  // チームを作り、後からメンバーを追加する（＝並び順の先頭に来るはず）
  await admin.goto("http://localhost:3000/company/settings");
  await admin.click("text=＋チームを作成");
  await admin.waitForTimeout(200);
  {
    const createModal = admin.locator("div.fixed.inset-0.z-30").last();
    await createModal.locator('input[placeholder="新しいチーム名"]').fill("並び順チーム");
    await createModal.getByRole("button", { name: "作成", exact: true }).click();
  }
  await admin.waitForTimeout(800);
  const teamId = psql(
    `select id from "Team" where "companyId"='${companyId}' and name='並び順チーム' order by "createdAt" desc limit 1;`,
  );

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "チーム所属スタッフ");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(800);
  const teamStaffUserId = psql(
    `select u.id from "User" u join "CompanyMembership" cm on cm."userId"=u.id where u.name='チーム所属スタッフ' and cm."companyId"='${companyId}' order by u."createdAt" desc limit 1;`,
  );
  psql(
    `insert into "TeamMembership" (id, "teamId", "userId", role, "createdAt") values (gen_random_uuid()::text, '${teamId}', '${teamStaffUserId}', 'TEAM_MEMBER', now());`,
  );

  // シフト作成ウィザード: チーム選択 → 社内 → 業務内容を選ばずに次へ → スタッフ選択
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.waitForTimeout(800);
  await admin.click("div.fixed.bottom-8.right-8 button");
  await admin.waitForTimeout(200);
  await admin.click("text=シフトを作成");
  await admin.waitForTimeout(300);
  const wizard = admin.locator("div.fixed.inset-0.z-20").last();
  await wizard.getByRole("button", { name: "並び順チーム" }).click();
  await admin.waitForTimeout(300);
  await wizard.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await admin.waitForTimeout(300);
  await wizard.getByRole("button", { name: "業務内容を選ばずに次へ" }).click();
  await admin.waitForTimeout(300);

  const labels = await wizard.locator("button").allTextContents();
  const teamStaffIndex = labels.findIndex((l) => l.includes("チーム所属スタッフ"));
  const unaffiliatedIndex = labels.findIndex((l) => l.includes("無所属スタッフ"));
  log(
    "チームメンバー（チーム所属スタッフ）が無所属スタッフより上に表示される",
    teamStaffIndex !== -1 && unaffiliatedIndex !== -1 && teamStaffIndex < unaffiliatedIndex,
  );
  log("チーム外のスタッフも引き続き一覧に表示される（絞り込みはしない）", unaffiliatedIndex !== -1);

  console.log(process.exitCode ? "SHIFT STAFF TEAM SORT SMOKE TEST HAD FAILURES" : "SHIFT STAFF TEAM SORT SMOKE TEST PASSED");
} catch (err) {
  console.error("SHIFT STAFF TEAM SORT SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-shift-staff-team-sort-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
