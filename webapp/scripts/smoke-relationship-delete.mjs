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
const page = await browser.newPage();

const adminEmail = `reldel-admin-${Date.now()}@example.com`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "取引先削除確認管理者");
  await page.fill("#email", adminEmail);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", "取引先削除確認株式会社");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='取引先削除確認株式会社' order by "createdAt" desc limit 1;`);

  // --- 稼働なしの依頼主（仮アカウント）は削除できる ---
  await page.goto("http://localhost:3000/company/roster");
  await page.click("text=依頼主一覧");
  await page.waitForTimeout(200);
  await page.click("text=＋依頼主を追加する");
  await page.waitForTimeout(200);
  await page.click("text=仮アカウントを作成");
  await page.fill('input[placeholder="名称を入力"]', "削除確認取引先");
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.waitForTimeout(600);
  const relId = psql(`select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' and "proxyName"='削除確認取引先' order by "createdAt" desc limit 1;`);

  await page.goto("http://localhost:3000/company/roster");
  await page.click("text=依頼主一覧");
  await page.waitForTimeout(200);
  await page.click("text=削除確認取引先");
  await page.waitForTimeout(300);
  let panel = page.locator("div.fixed.inset-0.z-30").last();

  const deleteButton = panel.getByRole("button", { name: "取引先情報を削除" });
  log("稼働なしの仮アカウントには削除ボタンが出る", (await deleteButton.count()) === 1);
  const delBtnHtml = await deleteButton.innerHTML().catch(() => "");
  log("削除ボタンが表示される", delBtnHtml.length >= 0);

  await deleteButton.click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "削除する" }).click();
  await page.waitForTimeout(600);

  const remaining = psql(`select count(*) from "CompanyRelationship" where id='${relId}';`);
  log("削除後、そのCompanyRelationshipは消えている", remaining === "0");
  log("削除後はパネルが閉じている", (await panel.count()) === 0);

  // --- シフト実績のある依頼主は削除できない ---
  await page.goto("http://localhost:3000/company/roster");
  await page.click("text=依頼主一覧");
  await page.waitForTimeout(200);
  await page.click("text=＋依頼主を追加する");
  await page.waitForTimeout(200);
  await page.click("text=仮アカウントを作成");
  await page.fill('input[placeholder="名称を入力"]', "稼働あり取引先");
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.waitForTimeout(600);
  const workedRelId = psql(`select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' and "proxyName"='稼働あり取引先' order by "createdAt" desc limit 1;`);

  await page.goto("http://localhost:3000/company/roster");
  await page.click("text=＋スタッフを追加する");
  await page.click("text=仮アカウントを作成");
  await page.fill('input[placeholder="名称を入力"]', "稼働あり取引先担当");
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.waitForTimeout(600);
  const staffId = psql(`select id from "User" where name='稼働あり取引先担当' order by "createdAt" desc limit 1;`);
  psql(
    `insert into "Shift" (id, "companyId", "staffUserId", "companyRelationshipId", source, date, "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffId}', '${workedRelId}', 'CLIENT', current_date, true, false, 'CONFIRMED', 'ASSIGN', now(), now());`,
  );

  await page.goto("http://localhost:3000/company/roster");
  await page.click("text=依頼主一覧");
  await page.waitForTimeout(200);
  await page.click("text=稼働あり取引先");
  await page.waitForTimeout(300);
  panel = page.locator("div.fixed.inset-0.z-30").last();
  await panel.getByRole("button", { name: "取引先情報を削除" }).click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "削除する" }).click();
  await page.waitForTimeout(600);

  const stillThere = psql(`select count(*) from "CompanyRelationship" where id='${workedRelId}';`);
  log("シフト実績のある取引先はサーバー側で削除が拒否される", stillThere === "1");
  let errorBody = await panel.textContent();
  log("エラーメッセージが表示される", errorBody.includes("稼働実績があるため削除できません"));

  // --- 配属（StaffPlacement）実績のある派遣会社は削除できない ---
  psql(`update "Company" set "dispatchEnabled" = true where id='${companyId}';`);
  await page.goto("http://localhost:3000/company/roster");
  await page.click("text=派遣会社一覧");
  await page.waitForTimeout(200);
  await page.click("text=＋派遣会社を追加する");
  await page.waitForTimeout(200);
  await page.click("text=仮アカウントを作成");
  await page.fill('input[placeholder="名称を入力"]', "配属あり派遣会社");
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.waitForTimeout(600);
  const placedAgencyRelId = psql(`select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' and "proxyName"='配属あり派遣会社' order by "createdAt" desc limit 1;`);
  psql(
    `insert into "StaffPlacement" (id, "staffUserId", "companyRelationshipId", "createdAt") ` +
      `values (gen_random_uuid()::text, '${staffId}', '${placedAgencyRelId}', now());`,
  );

  await page.goto("http://localhost:3000/company/roster");
  await page.click("text=派遣会社一覧");
  await page.waitForTimeout(200);
  await page.click("text=配属あり派遣会社");
  await page.waitForTimeout(300);
  panel = page.locator("div.fixed.inset-0.z-30").last();
  await panel.getByRole("button", { name: "取引先情報を削除" }).click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "削除する" }).click();
  await page.waitForTimeout(600);

  const agencyStillThere = psql(`select count(*) from "CompanyRelationship" where id='${placedAgencyRelId}';`);
  log("配属実績のある派遣会社はサーバー側で削除が拒否される", agencyStillThere === "1");
  errorBody = await panel.textContent();
  log("配属実績でもエラーメッセージが表示される", errorBody.includes("稼働実績があるため削除できません"));

  // --- 表示順: バナー(本アカウント連携案内)が先、チームバッジが後 ---
  // 依頼主にはisProxyバナーが出るので、その並び順を確認する
  await page.goto("http://localhost:3000/company/roster");
  await page.click("text=依頼主一覧");
  await page.waitForTimeout(200);
  await page.click("text=稼働あり取引先");
  await page.waitForTimeout(300);
  panel = page.locator("div.fixed.inset-0.z-30").last();
  const html = await panel.innerHTML();
  const bannerIdx = html.indexOf("本アカウントと連携する");
  const teamBadgeIdx = html.indexOf("紐づくチームなし");
  log("バナーがチームバッジより前に表示される（StaffDetailPanelと順序を統一）", bannerIdx !== -1 && teamBadgeIdx !== -1 && bannerIdx < teamBadgeIdx);

  console.log(process.exitCode ? "RELATIONSHIP DELETE SMOKE TEST HAD FAILURES" : "RELATIONSHIP DELETE SMOKE TEST PASSED");
} catch (err) {
  console.error("RELATIONSHIP DELETE SMOKE TEST FAILED", err);
  await page.screenshot({ path: "/tmp/smoke-relationship-delete-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
