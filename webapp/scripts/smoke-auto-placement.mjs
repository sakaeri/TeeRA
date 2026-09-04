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
const agencyCtx = await browser.newContext();
const agency = await agencyCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();
const clientCtx = await browser.newContext();
const client = await clientCtx.newPage();
const publicCtx = await browser.newContext();
const publicClient = await publicCtx.newPage();

const runId = Date.now();
const agencyEmail = `autopl-agency-${runId}@example.com`;
const staffEmail = `autopl-staff-${Date.now()}@example.com`;
const clientEmail = `autopl-client-${Date.now()}@example.com`;
const publicClientEmail = `autopl-public-${Date.now()}@example.com`;

try {
  // --- agency company + 1 team + a real staff + a proxy client (for the manual-assign test) ---
  await agency.goto("http://localhost:3000/register");
  await agency.fill("#name", "配属確認派遣元");
  await agency.fill("#email", agencyEmail);
  await agency.fill("#password", "password123");
  await agency.click("button[type=submit]");
  await agency.waitForURL("http://localhost:3000/register/company");
  await agency.fill("#name", "配属確認派遣元株式会社");
  await agency.click("button[type=submit]");
  await agency.waitForURL("http://localhost:3000/company");
  const agencyCompanyId = psql(`select id from "Company" where name='配属確認派遣元株式会社' order by "createdAt" desc limit 1;`);
  psql(`update "Company" set "agencyEnabled" = true where id='${agencyCompanyId}';`);

  await agency.goto("http://localhost:3000/company/roster");
  await agency.click("text=＋スタッフを追加する");
  await agency.click("text=本アカウントを招待");
  await agency.getByRole("button", { name: "招待URLを発行する" }).click();
  await agency.waitForSelector('input[readonly]');
  const inviteUrl = await agency.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "配属確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  await agency.goto("http://localhost:3000/company/roster");
  await agency.click("text=依頼主一覧");
  await agency.waitForTimeout(200);
  await agency.click("text=＋依頼主を追加する");
  await agency.waitForTimeout(200);
  await agency.click("text=仮アカウントを作成");
  await agency.fill('input[placeholder="名称を入力"]', "配属確認先");
  await agency.getByRole("button", { name: "作成", exact: true }).click();
  await agency.waitForTimeout(600);
  const relId = psql(`select id from "CompanyRelationship" where "ownerCompanyId"='${agencyCompanyId}' and "proxyName"='配属確認先' order by "createdAt" desc limit 1;`);

  const beforeCount = psql(`select count(*) from "StaffPlacement" where "staffUserId"='${staffUserId}' and "companyRelationshipId"='${relId}';`);
  log("シフト作成前は配属記録が無い", beforeCount === "0");

  // --- ① シフト作成で依頼主にアサイン → 配属記録が自動登録される ---
  await agency.goto("http://localhost:3000/company/calendar");
  await agency.locator("button", { hasText: "＋" }).last().click();
  await agency.getByText("シフトを作成").click();
  const modal = agency.locator("div.fixed.inset-0.z-20").last();
  if (await modal.getByText("どのチームのシフトを作成しますか？").count()) {
    await modal.getByRole("button").first().click();
    await agency.waitForTimeout(200);
  }
  await modal.getByRole("button", { name: "配属確認先" }).click();
  await modal.getByRole("button", { name: "＋ 新しい業務内容を追加する" }).click();
  await modal.locator('input[placeholder*="業務内容"]').fill("配属確認業務");
  await modal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await agency.waitForTimeout(300);
  await modal.getByRole("button", { name: "配属確認スタッフ" }).click();
  await modal.getByRole("button", { name: "次へ" }).click();
  await agency.waitForTimeout(300);
  await modal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await agency.waitForTimeout(800);

  const shiftCreated = psql(`select count(*) from "Shift" where "staffUserId"='${staffUserId}' and "companyRelationshipId"='${relId}' and "taskName"='配属確認業務';`);
  log("依頼主向けシフトが作成された", shiftCreated === "1");
  const afterManualAssign = psql(`select count(*) from "StaffPlacement" where "staffUserId"='${staffUserId}' and "companyRelationshipId"='${relId}';`);
  log("① シフト作成でのアサインで配属記録が自動登録される", afterManualAssign === "1");

  // 同じ依頼主にもう一度アサインしても行は増えない（upsertなので冪等）
  await agency.goto("http://localhost:3000/company/calendar");
  await agency.locator("button", { hasText: "＋" }).last().click();
  await agency.getByText("シフトを作成").click();
  const modal2 = agency.locator("div.fixed.inset-0.z-20").last();
  if (await modal2.getByText("どのチームのシフトを作成しますか？").count()) {
    await modal2.getByRole("button").first().click();
    await agency.waitForTimeout(200);
  }
  await modal2.getByRole("button", { name: "配属確認先" }).click();
  await modal2.getByRole("button", { name: "配属確認業務" }).click();
  await agency.waitForTimeout(300);
  await modal2.getByRole("button", { name: "配属確認スタッフ" }).click();
  await modal2.getByRole("button", { name: "次へ" }).click();
  await agency.waitForTimeout(300);
  await modal2.getByRole("button", { name: /件のシフトを作成/ }).click();
  await agency.waitForTimeout(800);
  const afterSecondAssign = psql(`select count(*) from "StaffPlacement" where "staffUserId"='${staffUserId}' and "companyRelationshipId"='${relId}';`);
  log("同じ依頼主に2回目のアサインをしても配属記録は1件のまま（冪等）", afterSecondAssign === "1");

  // --- ② オーダー（限定募集）へのアサイン → 配属記録が自動登録される ---
  await client.goto("http://localhost:3000/register");
  await client.fill("#name", "配属確認オーダー元担当者");
  await client.fill("#email", clientEmail);
  await client.fill("#password", "password123");
  await client.click("button[type=submit]");
  await client.waitForURL("http://localhost:3000/register/company");
  await client.fill("#name", "配属確認オーダー元株式会社");
  await client.click("button[type=submit]");
  await client.waitForURL("http://localhost:3000/company");
  const orderClientCompanyId = psql(`select id from "Company" where name='配属確認オーダー元株式会社' order by "createdAt" desc limit 1;`);

  const orderRelId = psql(
    `insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "clientCompanyId", status, "createdAt") ` +
      `values ('autopl-order-rel-${runId}', '${agencyCompanyId}', '${agencyCompanyId}', '${orderClientCompanyId}', 'ACTIVE', now());` +
      `select 'autopl-order-rel-${runId}';`,
  ).split("\n").pop();

  // 別日にする（当日は①のシフト作成アサインが既に入っており、時刻未指定
  // 同士は重複扱いになるため、コンフリクトを避けて別日でテストする）
  const recruitmentId = psql(
    `insert into "PublicRecruitment" (id, "companyId", title, date, "maxEntries", "lockedTee", status, visibility, "publishedAt", "createdAt", "updatedAt") ` +
      `values ('autopl-order-rec-${runId}', '${orderClientCompanyId}', '配属確認オーダー', current_date + 3, 1, 0, 'PUBLISHED', 'ORDER', now(), now(), now());` +
      `select 'autopl-order-rec-${runId}';`,
  ).split("\n").pop();

  const beforeOrderAssign = psql(`select count(*) from "StaffPlacement" where "staffUserId"='${staffUserId}' and "companyRelationshipId"='${orderRelId}';`);
  log("オーダーアサイン前は、そのオーダー元への配属記録が無い", beforeOrderAssign === "0");

  await agency.goto("http://localhost:3000/company/calendar");
  await agency.waitForTimeout(300);
  const orderDay = String(new Date(Date.now() + 3 * 86400000).getDate());
  await agency.locator(`button:has-text("${orderDay}")`).first().click();
  await agency.waitForTimeout(300);
  const dayModal = agency.locator("div.fixed.inset-0.z-20").last();
  await dayModal.getByRole("button", { name: "オーダー", exact: true }).click();
  await agency.waitForTimeout(300);
  await dayModal.getByRole("combobox").selectOption({ label: "配属確認スタッフ" });
  await dayModal.getByRole("button", { name: "アサイン" }).click();
  await agency.waitForTimeout(200);
  await dayModal.getByRole("button", { name: "確定" }).click();
  await agency.waitForTimeout(600);

  const orderShiftCount = psql(`select count(*) from "Shift" where "staffUserId"='${staffUserId}' and "publicRecruitmentId"='${recruitmentId}';`);
  log("オーダーが充足しシフトが作られた", orderShiftCount === "1");
  const afterOrderAssign = psql(`select count(*) from "StaffPlacement" where "staffUserId"='${staffUserId}' and "companyRelationshipId"='${orderRelId}';`);
  log("② オーダーへのアサインで配属記録が自動登録される", afterOrderAssign === "1");

  const totalPlacementsSoFar = psql(`select count(*) from "StaffPlacement" where "staffUserId"='${staffUserId}';`);
  log("ここまでで配属記録は2件（依頼主1件＋オーダー元1件）", totalPlacementsSoFar === "2");

  // --- ③ 公開募集(PUBLIC)への自己応募 → 配属記録は作られない（フリー） ---
  await publicClient.goto("http://localhost:3000/register");
  await publicClient.fill("#name", "配属確認公開募集元担当者");
  await publicClient.fill("#email", publicClientEmail);
  await publicClient.fill("#password", "password123");
  await publicClient.click("button[type=submit]");
  await publicClient.waitForURL("http://localhost:3000/register/company");
  await publicClient.fill("#name", "配属確認公開募集元株式会社");
  await publicClient.click("button[type=submit]");
  await publicClient.waitForURL("http://localhost:3000/company");
  const publicCompanyId = psql(`select id from "Company" where name='配属確認公開募集元株式会社' order by "createdAt" desc limit 1;`);
  // このスタッフの所属会社(agencyCompanyId)とは何の関係も無い、赤の他人の会社
  const publicTitle = `配属確認公開募集${runId}`;
  const publicRecId = psql(
    `insert into "PublicRecruitment" (id, "companyId", title, date, "maxEntries", "lockedTee", status, visibility, "hourlyWage", "wageType", "publishedAt", "createdAt", "updatedAt") ` +
      `values ('autopl-public-rec-${runId}', '${publicCompanyId}', '${publicTitle}', current_date + 1, 5, 0, 'PUBLISHED', 'PUBLIC', 1200, 'HOURLY', now(), now(), now());` +
      `select 'autopl-public-rec-${runId}';`,
  ).split("\n").pop();

  await staff.goto("http://localhost:3000/staff/recruitments");
  await staff.waitForTimeout(300);
  await staff
    .locator("li", { hasText: publicTitle })
    .getByRole("button", { name: "応募する" })
    .click();
  await staff.waitForTimeout(600);

  const publicApplyEntry = psql(`select count(*) from "RecruitmentEntry" where "publicRecruitmentId"='${publicRecId}' and "staffUserId"='${staffUserId}';`);
  log("公開募集への応募が成立した", publicApplyEntry === "1");
  const anyNewRelationshipToPublicCompany = psql(`select count(*) from "CompanyRelationship" where ("agencyCompanyId"='${agencyCompanyId}' and "clientCompanyId"='${publicCompanyId}') or ("clientCompanyId"='${agencyCompanyId}' and "agencyCompanyId"='${publicCompanyId}');`);
  log("公開募集への応募で新しいCompanyRelationshipは作られない", anyNewRelationshipToPublicCompany === "0");
  const totalPlacementsAfterPublicApply = psql(`select count(*) from "StaffPlacement" where "staffUserId"='${staffUserId}';`);
  log("③ 公開募集への自己応募では配属記録が増えない（フリーのまま）", totalPlacementsAfterPublicApply === "2");

  console.log(process.exitCode ? "AUTO PLACEMENT SMOKE TEST HAD FAILURES" : "AUTO PLACEMENT SMOKE TEST PASSED");
} catch (err) {
  console.error("AUTO PLACEMENT SMOKE TEST FAILED", err);
  await agency.screenshot({ path: "/tmp/smoke-auto-placement-agency-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-auto-placement-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
