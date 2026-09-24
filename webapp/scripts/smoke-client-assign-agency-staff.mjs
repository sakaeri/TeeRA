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

const clientEmail = `casg-client-${Date.now()}@example.com`;
const agencyEmail = `casg-agency-${Date.now()}@example.com`;
const staffEmail = `casg-staff-${Date.now()}@example.com`;

try {
  // --- client company ---
  await client.goto("http://localhost:3000/register");
  await client.fill("#name", "依頼主担当者");
  await client.fill("#email", clientEmail);
  await client.fill("#password", "password123");
  await client.click("button[type=submit]");
  await client.waitForURL("http://localhost:3000/register/company");
  await client.fill("#name", "配属アサイン依頼主株式会社");
  await client.click("button[type=submit]");
  await client.waitForURL("http://localhost:3000/company");
  const clientCompanyId = psql(`select id from "Company" where name='配属アサイン依頼主株式会社' order by "createdAt" desc limit 1;`);
  psql(`update "Company" set "dispatchEnabled" = true where id = '${clientCompanyId}';`);

  // --- agency company ---
  await agency.goto("http://localhost:3000/register");
  await agency.fill("#name", "派遣元担当者");
  await agency.fill("#email", agencyEmail);
  await agency.fill("#password", "password123");
  await agency.click("button[type=submit]");
  await agency.waitForURL("http://localhost:3000/register/company");
  await agency.fill("#name", "配属アサイン派遣元株式会社");
  await agency.click("button[type=submit]");
  await agency.waitForURL("http://localhost:3000/company");
  const agencyCompanyId = psql(`select id from "Company" where name='配属アサイン派遣元株式会社' order by "createdAt" desc limit 1;`);
  psql(`update "Company" set "agencyEnabled" = true where id = '${agencyCompanyId}';`);

  // --- real (non-proxy) relationship ---
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "clientCompanyId", status, "createdAt") ` +
      `values (gen_random_uuid()::text, '${agencyCompanyId}', '${agencyCompanyId}', '${clientCompanyId}', 'ACTIVE', now()) returning id) select id from ins;`,
  );

  // --- agency: invite + register a staff member ---
  await agency.goto("http://localhost:3000/company/roster");
  await agency.click("text=＋スタッフを追加する");
  await agency.click("text=本アカウントを招待");
  await agency.getByRole("button", { name: "招待URLを発行する" }).click();
  await agency.waitForSelector('input[readonly]');
  const inviteUrl = await agency.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "配属済みスタッフA");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // --- seed an existing active placement (staff already dispatched to this client before) ---
  psql(
    `insert into "StaffPlacement" (id, "staffUserId", "companyRelationshipId", active, "createdAt") ` +
      `values (gen_random_uuid()::text, '${staffUserId}', '${relId}', true, now());`,
  );

  // --- client: ＋シフトを作成 → 勤務先選択に派遣会社の配属済みスタッフの枠がある ---
  await client.goto("http://localhost:3000/company/calendar");
  await client.locator("button", { hasText: "＋" }).last().click();
  await client.getByText("シフトを作成").click();
  const modal = client.locator("div.fixed.inset-0.z-20").last();
  await client.waitForSelector("text=勤務先を選択");
  let bodyText = await modal.textContent();
  log("勤務先選択に「派遣会社の配属済みスタッフから選択」の案内が出る", bodyText.includes("派遣会社の配属済みスタッフから選択"));
  log("勤務先選択に派遣元の会社名がボタンとして出る", bodyText.includes("配属アサイン派遣元株式会社"));

  await modal.getByRole("button", { name: "配属アサイン派遣元株式会社" }).click();
  await client.waitForSelector("text=業務内容を選択");
  await modal.locator('input[placeholder*="業務内容"]').fill("フロント業務");
  await modal.getByRole("button", { name: "この業務内容にして次へ" }).click();
  await client.waitForTimeout(200);

  bodyText = await modal.textContent();
  log("スタッフ選択にはその派遣会社の配属済みスタッフだけが出る", bodyText.includes("配属済みスタッフA"));
  await modal.getByRole("button", { name: "配属済みスタッフA" }).click();
  await client.waitForSelector("text=日付を選択");
  await modal.getByRole("button", { name: "次へ" }).click();
  await client.waitForTimeout(300);

  bodyText = await modal.textContent();
  log("確認画面が表示される", bodyText.includes("内容を確認してください"));
  await modal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await client.waitForTimeout(600);

  // --- verify the resulting shift's actual ownership ---
  const shift = psql(
    `select "companyId", source, "companyRelationshipId", "teamId" from "Shift" where "staffUserId"='${staffUserId}' and "companyRelationshipId"='${relId}' order by "createdAt" desc limit 1;`,
  );
  const [shiftCompanyId, shiftSource, shiftRelId, shiftTeamId] = shift.split("|");
  log("作成されたシフトのcompanyIdは派遣会社側になる", shiftCompanyId === agencyCompanyId);
  log("sourceはCLIENT", shiftSource === "CLIENT");
  log("companyRelationshipIdは正しい関係のまま", shiftRelId === relId);
  log("teamIdは紐付かない（依頼主自身のチームではないため）", shiftTeamId === "");

  // --- verify it shows up on the agency's own calendar (not just the client's) ---
  await agency.goto("http://localhost:3000/company/calendar");
  await agency.waitForTimeout(400);
  bodyText = await agency.textContent("body");
  log("派遣会社自身のカレンダーにも反映される（companyIdスコープで自動的に見える）", bodyText.includes("配属済みスタッフA"));

  console.log(process.exitCode ? "CLIENT ASSIGN AGENCY STAFF SMOKE TEST HAD FAILURES" : "CLIENT ASSIGN AGENCY STAFF SMOKE TEST PASSED");
} catch (err) {
  console.error("CLIENT ASSIGN AGENCY STAFF SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
