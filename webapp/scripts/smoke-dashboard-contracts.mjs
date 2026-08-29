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
const ctx = await browser.newContext();
const page = await ctx.newPage();
const email = `dash-contracts-admin-${Date.now()}@example.com`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "契約管理者");
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", "契約テスト株式会社");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");

  const companyId = psql(
    `select cm."companyId" from "CompanyMembership" cm join "User" u on cm."userId"=u.id where u.email='${email}';`,
  );

  // seed a staff member with no live contract (未送付) via psql directly
  const staffEmail = `contract-staff-${Date.now()}@example.com`;
  psql(
    `insert into "User" (id, email, "passwordHash", name, "updatedAt") ` +
      `values (gen_random_uuid()::text, '${staffEmail}', 'x', '未契約スタッフ', now());`,
  );
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);
  psql(
    `insert into "CompanyMembership" (id, "companyId", "userId", role) ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'STAFF');`,
  );

  // seed a proxy-account staff member too — they must NOT appear in 契約書未確認
  // (isProxy accounts have no real login, so they can never be party to a contract)
  const proxyEmail = `proxy-staff-${Date.now()}@example.com`;
  psql(
    `insert into "User" (id, email, "passwordHash", name, "isProxy", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${proxyEmail}', 'x', '仮契約スタッフ', true, now());`,
  );
  const proxyUserId = psql(`select id from "User" where email='${proxyEmail}';`);
  psql(
    `insert into "CompanyMembership" (id, "companyId", "userId", role) ` +
      `values (gen_random_uuid()::text, '${companyId}', '${proxyUserId}', 'STAFF');`,
  );

  // seed an ACTIVE contract template for that company
  psql(
    `insert into "ContractTemplate" (id, "companyId", title, "employmentType", "workplaceType", "jobDescription", ` +
      `"scheduleType", "wageType", "wageAmount", "contractPeriodType", "contractStartDate", status, "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', 'アルバイト・事務', 'PART_TIME', 'INHOUSE', '事務作業', ` +
      `'SHIFT', 'HOURLY', 1200, 'INDEFINITE', '2026-09-01', 'ACTIVE', now());`,
  );

  await page.goto("http://localhost:3000/company");
  let body = await page.textContent("body");
  log("契約書未確認 KPI shows 1 (proxy excluded)", /契約書未確認[\s\S]{0,20}1/.test(body));

  await page.getByText("契約書未確認").click();
  await page.waitForTimeout(400);
  body = await page.textContent("body");
  log("契約書未確認 popup shows the unstarted staff with 未送付 tag", body.includes("未契約スタッフ") && body.includes("未送付"));
  log("proxy staff not shown in the popup", !body.includes("仮契約スタッフ"));
  log("no 再送信 button (not needed)", !body.includes("再送信"));

  await page.click("text=契約書を生成");
  await page.waitForTimeout(400);
  body = await page.textContent("body");
  log("base-template picker shows the template option", body.includes("アルバイト・事務"));

  await page.selectOption("select", { label: "アルバイト・事務" });
  await page.getByRole("button", { name: "次へ" }).click();
  await page.waitForTimeout(400);
  body = await page.textContent("body");
  log("full edit form opens, pre-filled from the base template, addressed to the staff", body.includes("未契約スタッフ様"));

  // edit the wage amount for this specific staff before generating
  await page.fill('input[type=number]', "1500");

  // preview toggle shows the real staff name in the 甲乙 sentence
  await page.getByRole("button", { name: "プレビュー" }).click();
  await page.waitForTimeout(300);
  body = await page.textContent("body");
  log("preview shows the real staff name instead of the placeholder", body.includes("未契約スタッフ（以下「乙」）"));

  await page.getByRole("button", { name: "内容を編集する" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "生成する" }).click();
  await page.waitForTimeout(700);

  const contract = psql(
    `select sc."wageAmountSnapshot", ct.title from "StaffContract" sc join "ContractTemplate" ct on sc."templateId"=ct.id ` +
      `where sc."staffUserId"='${staffUserId}' and sc.status='PENDING_CONSENT';`,
  );
  log(
    "StaffContract created as PENDING_CONSENT (本人の同意待ち) with the edited wage (1500)",
    contract.startsWith("1500|"),
  );
  log("a new duplicate template was created (not the original)", contract.includes("未契約スタッフ様"));

  const templateCount = psql(`select count(*) from "ContractTemplate" where "companyId"='${companyId}';`);
  log("original template preserved alongside the new duplicate (2 total)", templateCount === "2");

  await page.goto("http://localhost:3000/company");
  body = await page.textContent("body");
  log("契約書未確認 KPI back to 0 after generating", /契約書未確認[\s\S]{0,20}0/.test(body));

  console.log(process.exitCode ? "DASHBOARD CONTRACTS SMOKE TEST HAD FAILURES" : "DASHBOARD CONTRACTS SMOKE TEST PASSED");
} catch (err) {
  console.error("DASHBOARD CONTRACTS SMOKE TEST FAILED", err);
  await page.screenshot({ path: "/tmp/smoke-dashboard-contracts-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
