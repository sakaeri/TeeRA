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
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const runId = Date.now();
const adminEmail = `sdel-admin-${runId}@example.com`;
const staffEmail = `sdel-staff-${runId}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "削除確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "削除確認株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='削除確認株式会社' order by "createdAt" desc limit 1;`);

  // 間違えて同じ人の仮アカウントを2件作ってしまったケースを再現
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "重複太郎");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "重複太郎");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);

  const dupeIds = psql(
    `select u.id from "User" u join "CompanyMembership" cm on cm."userId"=u.id ` +
      `where u.name='重複太郎' and cm."companyId"='${companyId}' order by u."createdAt" asc;`,
  ).split("\n");
  log("仮アカウントが2件作られた", dupeIds.length === 2);
  const secondId = dupeIds[1];

  // ✎編集ボタンの矢印を確認（左向きに反転してあるか）
  await admin.click("text=重複太郎 >> nth=1");
  await admin.waitForTimeout(300);
  let panel = admin.locator("div.fixed.inset-0.z-30").last();
  let editBtnHtml = await panel.getByRole("button", { name: "チーム所属を編集" }).innerHTML();
  log("✎アイコンが左右反転されている（scale-x-[-1]）", editBtnHtml.includes("scale-x-[-1]"));

  const deleteButton = panel.getByRole("button", { name: "スタッフ情報を削除" });
  log("仮アカウント（稼働なし）には削除ボタンが出る", (await deleteButton.count()) === 1);

  await deleteButton.click();
  await admin.waitForTimeout(200);
  await admin.getByRole("button", { name: "削除する" }).click();
  await admin.waitForTimeout(600);

  const remaining = psql(`select count(*) from "User" where id='${secondId}';`);
  log("削除後、そのUserは消えている", remaining === "0");
  log("削除後はパネルが閉じている", (await panel.count()) === 0);

  const remainingCount = psql(
    `select count(*) from "User" u join "CompanyMembership" cm on cm."userId"=u.id ` +
      `where u.name='重複太郎' and cm."companyId"='${companyId}';`,
  );
  log("残った方の重複太郎は消えていない", remainingCount === "1");

  // --- 稼働がある仮アカウントは削除できない ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "稼働確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=稼働確認スタッフ");
  await admin.waitForTimeout(300);
  panel = admin.locator("div.fixed.inset-0.z-30").last();
  log("本アカウントには削除ボタンが出ない", (await panel.getByRole("button", { name: "スタッフ情報を削除" }).count()) === 0);

  // --- 稼働がある仮アカウントは削除ボタンを押してもサーバー側で弾かれる ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "稼働あり仮太郎");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);
  const workedProxyId = psql(`select id from "User" where name='稼働あり仮太郎' order by "createdAt" desc limit 1;`);
  psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, date, "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${workedProxyId}', 'INHOUSE', current_date, true, false, 'CONFIRMED', 'ASSIGN', now(), now());`,
  );

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=稼働あり仮太郎");
  await admin.waitForTimeout(300);
  panel = admin.locator("div.fixed.inset-0.z-30").last();
  await panel.getByRole("button", { name: "スタッフ情報を削除" }).click();
  await admin.waitForTimeout(200);
  await admin.getByRole("button", { name: "削除する" }).click();
  await admin.waitForTimeout(600);

  const stillThere = psql(`select count(*) from "User" where id='${workedProxyId}';`);
  log("稼働実績のある仮アカウントはサーバー側で削除が拒否される", stillThere === "1");
  const errorBody = await panel.textContent();
  log("エラーメッセージが表示される", errorBody.includes("稼働実績があるため削除できません"));

  // --- シフトはまだ無くても、配属（StaffPlacement）実績があれば削除できない ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "配属あり仮太郎");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);
  const placedProxyId = psql(`select id from "User" where name='配属あり仮太郎' order by "createdAt" desc limit 1;`);
  const placedRelId = `sdel-placed-rel-${runId}`;
  psql(
    `insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", "createdAt") ` +
      `values ('${placedRelId}', '${companyId}', '${companyId}', '配属確認取引先', now());`,
  );
  psql(
    `insert into "StaffPlacement" (id, "staffUserId", "companyRelationshipId", "createdAt") ` +
      `values (gen_random_uuid()::text, '${placedProxyId}', '${placedRelId}', now());`,
  );

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=配属あり仮太郎");
  await admin.waitForTimeout(300);
  panel = admin.locator("div.fixed.inset-0.z-30").last();
  await panel.getByRole("button", { name: "スタッフ情報を削除" }).click();
  await admin.waitForTimeout(200);
  await admin.getByRole("button", { name: "削除する" }).click();
  await admin.waitForTimeout(600);

  const placedStillThere = psql(`select count(*) from "User" where id='${placedProxyId}';`);
  log("配属実績のみ（シフト無し）の仮アカウントもサーバー側で削除が拒否される", placedStillThere === "1");
  const placedErrorBody = await panel.textContent();
  log("配属実績のエラーメッセージが表示される", placedErrorBody.includes("稼働実績があるため削除できません"));

  console.log(process.exitCode ? "STAFF DELETE SMOKE TEST HAD FAILURES" : "STAFF DELETE SMOKE TEST PASSED");
} catch (err) {
  console.error("STAFF DELETE SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-staff-delete-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-staff-delete-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
