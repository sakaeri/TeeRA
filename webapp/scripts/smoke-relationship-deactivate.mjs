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
const clientCtx = await browser.newContext();
const client = await clientCtx.newPage();
const agencyCtx = await browser.newContext();
const agency = await agencyCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const clientEmail = `rdeact-client-${Date.now()}@example.com`;
const agencyEmail = `rdeact-agency-${Date.now()}@example.com`;
const staffEmail = `rdeact-staff-${Date.now()}@example.com`;

try {
  // --- client company ---
  await client.goto("http://localhost:3000/register");
  await client.fill("#name", "連携終了依頼主担当者");
  await client.fill("#email", clientEmail);
  await client.fill("#password", "password123");
  await client.click("button[type=submit]");
  await client.waitForURL("http://localhost:3000/register/company");
  await client.fill("#name", "連携終了依頼主株式会社");
  await client.click("button[type=submit]");
  await client.waitForURL("http://localhost:3000/company");
  const clientCompanyId = psql(`select id from "Company" where name='連携終了依頼主株式会社' order by "createdAt" desc limit 1;`);
  psql(`update "Company" set "dispatchEnabled" = true where id = '${clientCompanyId}';`);

  // --- agency company ---
  await agency.goto("http://localhost:3000/register");
  await agency.fill("#name", "連携終了派遣元担当者");
  await agency.fill("#email", agencyEmail);
  await agency.fill("#password", "password123");
  await agency.click("button[type=submit]");
  await agency.waitForURL("http://localhost:3000/register/company");
  await agency.fill("#name", "連携終了派遣元株式会社");
  await agency.click("button[type=submit]");
  await agency.waitForURL("http://localhost:3000/company");
  const agencyCompanyId = psql(`select id from "Company" where name='連携終了派遣元株式会社' order by "createdAt" desc limit 1;`);
  psql(`update "Company" set "agencyEnabled" = true where id = '${agencyCompanyId}';`);

  // --- real (non-proxy) relationship, with an existing active placement ---
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "clientCompanyId", status, "createdAt") ` +
      `values (gen_random_uuid()::text, '${agencyCompanyId}', '${agencyCompanyId}', '${clientCompanyId}', 'ACTIVE', now()) returning id) select id from ins;`,
  );

  await agency.goto("http://localhost:3000/company/roster");
  await agency.click("text=＋スタッフを追加する");
  await agency.click("text=本アカウントを招待");
  await agency.getByRole("button", { name: "招待URLを発行する" }).click();
  await agency.waitForSelector('input[readonly]');
  const inviteUrl = await agency.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "連携終了配属スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  psql(
    `insert into "StaffPlacement" (id, "staffUserId", "companyRelationshipId", active, "createdAt") ` +
      `values (gen_random_uuid()::text, '${staffUserId}', '${relId}', true, now());`,
  );

  // --- baseline: client can see the agency's placed staff when creating a shift ---
  async function agencyVisibleInShiftPicker() {
    await client.goto("http://localhost:3000/company/calendar");
    await client.locator("button", { hasText: "＋" }).last().click();
    await client.getByText("シフトを作成").click();
    const modal = client.locator("div.fixed.inset-0.z-20").last();
    await client.waitForSelector("text=勤務先を選択");
    const bodyText = await modal.textContent();
    await client.keyboard.press("Escape").catch(() => {});
    return bodyText.includes("連携終了派遣元株式会社");
  }

  log("連携中は依頼主のシフト作成で派遣元が選択肢に出る", await agencyVisibleInShiftPicker());

  // --- client: open the agency's detail panel and end the relationship ---
  await client.goto("http://localhost:3000/company/roster");
  await client.getByRole("button", { name: /派遣会社一覧/ }).click();
  await client.waitForTimeout(300);
  await client.click("text=連携終了派遣元株式会社");
  await client.waitForTimeout(400);
  const panel = client.locator("div.fixed.inset-0.z-30, div.fixed.inset-0.z-20").last();
  let bodyText = await panel.textContent();
  log("実績のある本アカウント連携にも「連携を終了する」ボタンが出る", bodyText.includes("連携を終了する"));

  await panel.getByRole("button", { name: "連携を終了する" }).click();
  await client.waitForTimeout(200);
  const confirmModal = client.locator("div.fixed.inset-0.z-40").last();
  await confirmModal.getByRole("button", { name: "終了する" }).click();
  await client.waitForTimeout(500);
  bodyText = await panel.textContent();
  log("終了後は「連携終了済み」バッジが表示される", bodyText.includes("連携終了済み"));
  log("終了後はボタンが「連携を再開する」に変わる", bodyText.includes("連携を再開する"));

  const statusAfterDeactivate = psql(`select status from "CompanyRelationship" where id='${relId}';`);
  log("DB上もstatus=INACTIVEになる", statusAfterDeactivate === "INACTIVE");

  log("終了後は依頼主のシフト作成に派遣元が選択肢に出なくなる", !(await agencyVisibleInShiftPicker()));

  // --- reactivate ---
  await client.goto("http://localhost:3000/company/roster");
  await client.getByRole("button", { name: /派遣会社一覧/ }).click();
  await client.waitForTimeout(300);
  await client.click("text=連携終了派遣元株式会社");
  await client.waitForTimeout(400);
  const panel2 = client.locator("div.fixed.inset-0.z-30, div.fixed.inset-0.z-20").last();
  await panel2.getByRole("button", { name: "連携を再開する" }).click();
  await client.waitForTimeout(500);
  bodyText = await panel2.textContent();
  log("再開後は「連携終了済み」バッジが消える", !bodyText.includes("連携終了済み"));
  log("再開後はボタンが「連携を終了する」に戻る", bodyText.includes("連携を終了する"));

  const statusAfterReactivate = psql(`select status from "CompanyRelationship" where id='${relId}';`);
  log("DB上もstatus=ACTIVEに戻る", statusAfterReactivate === "ACTIVE");

  log("再開後は依頼主のシフト作成に派遣元が選択肢に再び出る", await agencyVisibleInShiftPicker());

  // --- proxy (実体の無い) relationship: canDeactivate=false のため、終了ボタン自体が出ない ---
  const proxyRelId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "clientCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") ` +
      `values (gen_random_uuid()::text, '${clientCompanyId}', '${clientCompanyId}', null, '連携終了テスト架空派遣', 'ACTIVE', now()) returning id) select id from ins;`,
  );
  await client.goto("http://localhost:3000/company/roster");
  await client.getByRole("button", { name: /派遣会社一覧/ }).click();
  await client.waitForTimeout(300);
  await client.click("text=連携終了テスト架空派遣");
  await client.waitForTimeout(400);
  const proxyPanel = client.locator("div.fixed.inset-0.z-30, div.fixed.inset-0.z-20").last();
  bodyText = await proxyPanel.textContent();
  log("仮アカウントのままの関係には「連携を終了する」ボタンが出ない", !bodyText.includes("連携を終了する"));
  void proxyRelId;

  console.log(process.exitCode ? "RELATIONSHIP DEACTIVATE SMOKE TEST HAD FAILURES" : "RELATIONSHIP DEACTIVATE SMOKE TEST PASSED");
} catch (err) {
  console.error("RELATIONSHIP DEACTIVATE SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
