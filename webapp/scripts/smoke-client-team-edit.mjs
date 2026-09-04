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

const adminEmail = `cte-admin-${Date.now()}@example.com`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "取引先編集確認管理者");
  await page.fill("#email", adminEmail);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", "取引先編集確認株式会社");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='取引先編集確認株式会社' order by "createdAt" desc limit 1;`);

  await page.goto("http://localhost:3000/company/settings?tab=teams");
  await page.fill('input[placeholder="新しいチーム名"]', "Aチーム");
  await page.getByRole("button", { name: "＋チームを作成" }).click();
  await page.waitForTimeout(400);
  let body = await page.textContent("body");
  log("設定画面のチームカードに「主な取引先」の項目が無い", !body.includes("主な取引先"));

  const teamAId = psql(`select id from "Team" where "companyId"='${companyId}' and name='Aチーム';`);

  // 依頼主を仮アカウントで作成
  await page.goto("http://localhost:3000/company/roster");
  await page.click("text=依頼主一覧");
  await page.waitForTimeout(200);
  await page.click("text=＋依頼主を追加する");
  await page.waitForTimeout(200);
  await page.click("text=仮アカウントを作成");
  await page.fill('input[placeholder="名称を入力"]', "編集確認取引先");
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.waitForTimeout(600);
  const relId = psql(`select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' order by "createdAt" desc limit 1;`);

  await page.goto("http://localhost:3000/company/roster");
  await page.click("text=依頼主一覧");
  await page.waitForTimeout(200);
  await page.click("text=編集確認取引先");
  await page.waitForTimeout(300);
  let panel = page.locator("div.fixed.inset-0.z-30").last();
  body = await panel.textContent();
  log("最初は「紐づくチームなし」", body.includes("紐づくチームなし"));

  const editBtn = panel.getByRole("button", { name: "チームとの紐付けを編集" });
  const editBtnHtml = await editBtn.innerHTML();
  log("✎アイコンが左右反転されている", editBtnHtml.includes("scale-x-[-1]"));

  await editBtn.click();
  await page.waitForTimeout(200);
  await panel.locator("label", { hasText: "Aチーム" }).locator('input[type=checkbox]').check();
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(500);

  const linkCount = psql(`select count(*) from "TeamClientRelationship" where "teamId"='${teamAId}' and "companyRelationshipId"='${relId}';`);
  log("編集パネルからAチームに紐付けられた", linkCount === "1");
  body = await panel.textContent();
  log("バッジにAチームが表示される", body.includes("Aチーム"));

  // 外す方向も確認
  await editBtn.click();
  await page.waitForTimeout(200);
  await panel.locator("label", { hasText: "Aチーム" }).locator('input[type=checkbox]').uncheck();
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForTimeout(500);
  const linkCountAfter = psql(`select count(*) from "TeamClientRelationship" where "teamId"='${teamAId}' and "companyRelationshipId"='${relId}';`);
  log("チェックを外すと紐付けが消える", linkCountAfter === "0");

  console.log(process.exitCode ? "CLIENT TEAM EDIT SMOKE TEST HAD FAILURES" : "CLIENT TEAM EDIT SMOKE TEST PASSED");
} catch (err) {
  console.error("CLIENT TEAM EDIT SMOKE TEST FAILED", err);
  await page.screenshot({ path: "/tmp/smoke-client-team-edit-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
