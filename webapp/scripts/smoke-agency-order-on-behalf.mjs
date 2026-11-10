import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { createRecruitmentViaWizard } from "./_lib/recruitmentWizard.mjs";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 派遣会社が依頼主の代わりにオーダーを出す：
// ・募集の作成で勤務先として依頼主を選べる（選ばなければ今まで通り自社の募集）
// ・スタッフの募集一覧に「依頼主（派遣会社）」と出る
// ・応募して決まったシフトは、その依頼主の現場のシフト（source=CLIENT・依頼主とのひも付けあり）になる
// ・依頼主（本アカウント）のカレンダーに「派遣会社が入力」と出る（依頼主が自分のオーダーから決めたシフトには出ない）
// ・逆に、派遣会社のカレンダーでは、依頼主が入れたシフトに「依頼主が入力」と出る

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`)
    .toString()
    .split("\n")
    .filter((line) => !/^(INSERT|UPDATE|DELETE)\s/.test(line))
    .join("\n")
    .trim();
}
async function registerCompany(page, name, email) {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "担当者");
  await page.fill("#email", email);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", name);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  return psql(`select id from "Company" where name='${name}' order by "createdAt" desc limit 1;`);
}

async function applyFromConfirmFactory(page) {
  return async () => {
    const dialogOpen = await page.getByText("この募集に応募しますか？").isVisible().catch(() => false);
    if (!dialogOpen) await page.getByRole("button", { name: /応募する/ }).last().click();
    await page.getByText("この募集に応募しますか？").waitFor();
    await page.locator("div.fixed", { hasText: "この募集に応募しますか？" }).getByRole("button", { name: "応募する" }).click();
    await page.waitForTimeout(1500);
  };
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const agency = await (await browser.newContext()).newPage();
const client = await (await browser.newContext()).newPage();
const staff = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const s = Date.now();
const applyFromConfirm = await applyFromConfirmFactory(staff);
const clientName = `現場依頼主${s}`;
const agencyName = `代理派遣${s}`;

try {
  const clientId = await registerCompany(client, clientName, `obo-client-${s}@example.com`);
  const agencyId = await registerCompany(agency, agencyName, `obo-agency-${s}@example.com`);
  psql(`update "Company" set "agencyEnabled"=true where id='${agencyId}';`);
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "clientCompanyId", status, "createdAt") values (gen_random_uuid()::text, '${agencyId}', '${agencyId}', '${clientId}', 'ACTIVE', now()) returning id) select id from ins;`,
  );

  // 派遣会社のスタッフ
  await agency.goto("http://localhost:3000/company/roster");
  await agency.click("text=＋スタッフを追加");
  await agency.click("text=本アカウントを招待");
  await agency.getByRole("button", { name: "招待URLを発行する" }).click();
  await agency.waitForSelector("input[readonly]");
  const inviteUrl = await agency.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "代理スタッフ");
  await staff.fill("#email", `obo-staff-${s}@example.com`);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffId = psql(`select id from "User" where email='obo-staff-${s}@example.com';`);

  // --- 派遣会社：依頼主の代わりにオーダーを出す ---
  await agency.goto("http://localhost:3000/company/calendar");
  await agency.locator("button", { hasText: "＋" }).last().click();
  await agency.getByText("募集を作成").click();
  const modal = agency.locator("div.fixed.inset-0.z-20").last();
  log("募集の作成で勤務先（自社か依頼主）を選ぶ画面が出る", (await modal.innerText()).includes("勤務先を選択") && (await modal.innerText()).includes(clientName));
  await createRecruitmentViaWizard(agency, { taskName: "代理オーダー業務", workplace: clientName, confirm: false });
  log("確認画面に勤務先として依頼主の名前が出る", (await modal.innerText()).includes(clientName));
  await modal.getByRole("button", { name: /件の募集を作成/ }).click();
  await agency.waitForTimeout(800);
  const rec = psql(`select id||'|'||coalesce("companyRelationshipId",'') from "PublicRecruitment" where "companyId"='${agencyId}' order by "createdAt" desc limit 1;`).split("|");
  log("オーダーに依頼主（現場）が記録される", rec[1] === relId);

  // --- スタッフ：一覧に「依頼主（派遣会社）」と出て、応募するとその依頼主の現場のシフトになる ---
  await staff.goto("http://localhost:3000/staff/recruitments");
  await staff.waitForTimeout(1200);
  const listText = await staff.locator("main").innerText();
  log("スタッフの募集一覧に「依頼主（派遣会社）」と出る", listText.includes(`${clientName}（${agencyName}）`));
  await staff.locator(`[data-testid='recruitment-${rec[0]}'] button`).first().click();
  await applyFromConfirm();
  const shift = psql(`select source||'|'||coalesce("companyRelationshipId",'')||'|'||coalesce("createdByCompanyId",'')||'|'||coalesce("taskName",'') from "Shift" where "staffUserId"='${staffId}' order by "createdAt" desc limit 1;`).split("|");
  log("応募で決まったシフトは依頼主の現場のシフト（CLIENT・依頼主とひも付け）になる", shift[0] === "CLIENT" && shift[1] === relId);
  log("シフトを入れた会社として派遣会社が記録される", shift[2] === agencyId);
  log("業務内容（単価の計算に使う）も入る", shift[3] === "代理オーダー業務");

  // --- 依頼主のカレンダーに「派遣会社が入力」と出る ---
  const date = psql(`select to_char(date,'YYYY-MM-DD') from "Shift" where "staffUserId"='${staffId}' order by "createdAt" desc limit 1;`);
  await client.goto(`http://localhost:3000/company/calendar?date=${date}`);
  await client.waitForTimeout(1500);
  log("依頼主のカレンダーに「派遣会社が入力」と出る", (await client.locator("main").innerText()).includes("派遣会社が入力"));
  await agency.goto(`http://localhost:3000/company/calendar?date=${date}`);
  await agency.waitForTimeout(1500);
  log("派遣会社が自分で入れたシフトには、派遣会社の画面で「依頼主が入力」と出ない", !(await agency.locator("main").innerText()).includes("依頼主が入力"));

  // 依頼主が自分のオーダーから決めたシフト（派遣会社のスタッフが応募）には出ない
  psql(`delete from "Shift" where "staffUserId"='${staffId}';`);
  psql(`insert into "StaffPlacement" (id, "staffUserId", "companyRelationshipId", active, "createdAt") values (gen_random_uuid()::text, '${staffId}', '${relId}', true, now()) on conflict do nothing;`);
  psql(
    `insert into "PublicRecruitment" (id, "companyId", title, date, "startTime", "endTime", "maxEntries", "lockedTee", status, visibility, "isUndecided", "extraItems", "publishedAt", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${clientId}', '依頼主自身のオーダー', '${date}', '08:00', '12:00', 1, 0, 'PUBLISHED', 'ORDER', false, '[]'::jsonb, now(), now(), now());`,
  );
  await staff.goto("http://localhost:3000/staff/recruitments");
  await staff.waitForTimeout(1200);
  const ownRec = psql(`select id from "PublicRecruitment" where "companyId"='${clientId}' order by "createdAt" desc limit 1;`);
  await staff.locator(`[data-testid='recruitment-${ownRec}'] button`).first().click();
  await applyFromConfirm();
  log("依頼主のオーダーから決まったシフトは、依頼主が入れたシフトとして記録される", psql(`select "createdByCompanyId" from "Shift" where "staffUserId"='${staffId}' order by "createdAt" desc limit 1;`) === clientId);
  await client.goto(`http://localhost:3000/company/calendar?date=${date}`);
  await client.waitForTimeout(1500);
  log("依頼主が自分のオーダーから決めたシフトには「派遣会社が入力」と出ない", !(await client.locator("main").innerText()).includes("派遣会社が入力"));
  await agency.goto(`http://localhost:3000/company/calendar?date=${date}`);
  await agency.waitForTimeout(1500);
  log("依頼主のオーダーから決まったシフトは、派遣会社の画面に「依頼主が入力」と出る", (await agency.locator("main").innerText()).includes("依頼主が入力"));

  console.log(process.exitCode ? "AGENCY ORDER ON BEHALF SMOKE TEST HAD FAILURES" : "AGENCY ORDER ON BEHALF SMOKE TEST PASSED");
} catch (e) {
  console.error(e);
  await agency.screenshot({ path: "/tmp/obo-agency-fail.png" }).catch(() => {});
  await staff.screenshot({ path: "/tmp/obo-staff-fail.png" }).catch(() => {});
  await client.screenshot({ path: "/tmp/obo-client-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
