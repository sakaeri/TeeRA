import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

function psql(sql) {
  return execSync(
    `PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`,
  )
    .toString()
    .trim();
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const page = await browser.newPage();
const email = `proxy-team-link-smoke-${Date.now()}@example.com`;
const companyName = `仮取引先チーム紐付けテスト株式会社${Date.now()}`;

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "紐付け太郎");
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");

  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  // create a team first, so the proxy-creation modal's team-selector has an option
  await page.click("text=設定");
  await page.waitForURL("http://localhost:3000/company/settings");
  await page.click("text=＋チームを作成");
  await page.waitForTimeout(200);
  {
    const createModal = page.locator("div.fixed.inset-0.z-30").last();
    await createModal.locator('input[placeholder="新しいチーム名"]').fill("紐付けチームA");
    await createModal.getByRole("button", { name: "作成", exact: true }).click();
  }
  await page.waitForTimeout(800);
  const teamAId = psql(`select id from "Team" where "companyId"='${companyId}' and name='紐付けチームA';`);
  log("team created", !!teamAId);

  // go to roster, create a proxy client WITH a team selected
  await page.click("text=スタッフ名簿");
  await page.waitForURL("http://localhost:3000/company/roster");
  await page.click("text=依頼主一覧");
  await page.waitForTimeout(200);
  await page.click("text=＋依頼主を追加する");
  await page.waitForTimeout(200);
  await page.click("text=仮アカウントを作成");
  await page.waitForTimeout(200);
  log(
    "team-selector shown for proxy client creation",
    await page.locator("text=チームと紐付ける（任意）").isVisible(),
  );
  await page.fill('input[placeholder="名称を入力"]', "紐付け先依頼主A");
  await page.selectOption('select:near(:text("チームと紐付ける"))', { label: "紐付けチームA" });
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.waitForTimeout(800);
  let bodyText = await page.textContent("body");
  log("proxy client created", bodyText.includes("紐付け先依頼主A"));

  const relAId = psql(
    `select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' and "proxyName"='紐付け先依頼主A';`,
  );
  const linkCountA = psql(
    `select count(*) from "TeamClientRelationship" where "companyRelationshipId"='${relAId}' and "teamId"='${teamAId}';`,
  );
  log("TeamClientRelationship row created when a team was selected", linkCountA === "1");

  // create a SECOND proxy client WITHOUT selecting a team (default "紐付けない")
  await page.click("text=＋依頼主を追加する");
  await page.waitForTimeout(200);
  await page.click("text=仮アカウントを作成");
  await page.waitForTimeout(200);
  await page.fill('input[placeholder="名称を入力"]', "紐付け先依頼主B");
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.waitForTimeout(800);
  bodyText = await page.textContent("body");
  log("second proxy client created", bodyText.includes("紐付け先依頼主B"));

  const relBId = psql(
    `select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' and "proxyName"='紐付け先依頼主B';`,
  );
  const linkCountB = psql(`select count(*) from "TeamClientRelationship" where "companyRelationshipId"='${relBId}';`);
  log("no TeamClientRelationship row created when left unset (default behavior unchanged)", linkCountB === "0");

  // same check for 派遣会社 tab (shares the same code path)
  await page.click("text=派遣会社一覧");
  await page.waitForTimeout(200);
  await page.click("text=＋派遣会社を追加する");
  await page.waitForTimeout(200);
  await page.click("text=仮アカウントを作成");
  await page.waitForTimeout(200);
  log(
    "team-selector shown for proxy agency creation",
    await page.locator("text=チームと紐付ける（任意）").isVisible(),
  );
  await page.fill('input[placeholder="名称を入力"]', "紐付け先派遣会社A");
  await page.selectOption('select:near(:text("チームと紐付ける"))', { label: "紐付けチームA" });
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.waitForTimeout(800);
  bodyText = await page.textContent("body");
  log("proxy agency created", bodyText.includes("紐付け先派遣会社A"));

  const relCId = psql(
    `select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' and "proxyName"='紐付け先派遣会社A';`,
  );
  const linkCountC = psql(
    `select count(*) from "TeamClientRelationship" where "companyRelationshipId"='${relCId}' and "teamId"='${teamAId}';`,
  );
  log("TeamClientRelationship row created for proxy agency when a team was selected", linkCountC === "1");

  console.log(process.exitCode ? "PROXY CLIENT TEAM LINK SMOKE TEST HAD FAILURES" : "PROXY CLIENT TEAM LINK SMOKE TEST PASSED");
} catch (err) {
  console.error("PROXY CLIENT TEAM LINK SMOKE TEST FAILED", err);
  await page.screenshot({ path: "/tmp/smoke-proxy-client-team-link-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
