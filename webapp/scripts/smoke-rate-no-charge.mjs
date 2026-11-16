import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

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

const adminEmail = `inv-admin-${Date.now()}@example.com`;
const staffEmail = `inv-staff-${Date.now()}@example.com`;
const today = new Date().toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "請求なし管理者");
  await admin.fill("#email", adminEmail);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "請求なし株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  const companyId = psql(`select id from "Company" where name='請求なし株式会社' order by "createdAt" desc limit 1;`);
  psql(
    `update "Company" set "teeBalance" = 10, "invoiceRegistrationNumber" = 'T1234567890123' where id = '${companyId}';` +
      `insert into "TeeLedgerEntry" (id, "companyId", type, amount, "balanceAfter", "createdAt") values (gen_random_uuid()::text, '${companyId}', 'ADJUSTMENT', 10, 10, now());`,
  );

  // activate agency module with a proxy client
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "GREEN TABLE 渋谷店");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);
  const companyRelationshipId = psql(
    `select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' order by "createdAt" desc limit 1;`,
  );
  log("proxy client relationship created", Boolean(companyRelationshipId));

  // 依頼主の単価：接客 1500円、研修は「請求なし」
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=GREEN TABLE 渋谷店");
  await admin.waitForTimeout(300);
  const clientPanel = admin.locator("div.fixed.inset-0.z-30").last();
  await clientPanel.getByRole("button", { name: "単価", exact: true }).click();
  await clientPanel.getByRole("button", { name: "＋業務内容を追加" }).click();
  await clientPanel.locator('input[placeholder*="業務内容"]').fill("接客");
  await clientPanel.locator('input[placeholder="金額"]').fill("1500");
  await clientPanel.getByRole("button", { name: "追加", exact: true }).click();
  await admin.waitForTimeout(800);
  await clientPanel.getByRole("button", { name: "＋業務内容を追加" }).click();
  const taskInput = clientPanel.locator('input[placeholder*="業務内容"]');
  if (await taskInput.count()) await taskInput.fill("研修");
  else {
    // 登録済みの業務内容から選ぶ画面の場合は「新しく入力」へ
    await admin.locator("select").filter({ hasText: "業務内容を選択" }).selectOption({ label: "＋ 新しい業務内容を追加する" });
    await admin.locator('input[placeholder*="業務内容"]').fill("研修");
  }
  await admin.getByTestId("new-no-charge").locator("input").check();
  log("請求なしにすると金額の欄が消える", (await admin.locator('input[placeholder="金額"]').count()) === 0);
  await admin.screenshot({ path: "/tmp/nocharge-form.png" });
  await admin.getByRole("button", { name: "追加", exact: true }).click();
  await admin.waitForTimeout(800);
  log("研修は0円（請求なし）で保存される", psql(`select v.amount from "CompanyPlacementRateVersion" v join "CompanyPlacementRate" r on r.id=v."placementRateId" where r."companyRelationshipId"='${companyRelationshipId}' and r."taskName"='研修' order by v."createdAt" desc limit 1;`) === "0");
  log("単価の一覧に「請求なし」と出る", (await clientPanel.innerText()).includes("請求なし"));
  await admin.screenshot({ path: "/tmp/nocharge-list.png" });

  // 今月の承認済みシフト：接客と研修
  const staffId = psql(`with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'nocharge-${Date.now()}@example.com', 'x', '研修スタッフ', now()) returning id) select id from ins;`);
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);
  const day1 = today;
  const day2 = today;
  for (const [d, task] of [[day1, "接客"], [day2, "研修"]]) {
    const sid = psql(`with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", status, "createdVia", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'CLIENT', '${companyRelationshipId}', '${task}', '${d}', '09:00', '17:00', 'CONFIRMED', 'ASSIGN', now()) returning id) select id from ins;`);
    psql(`insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "clockIn", "clockOut", "breakMinutes", "computedMinutes", "approvalStatus", "submittedAt", "updatedAt") values (gen_random_uuid()::text, '${sid}', '${staffId}', 'WORKED', '${d} 00:00', '${d} 08:00', 0, 480, 'APPROVED', now(), now());`);
  }
  await admin.goto(`http://localhost:3000/company/invoices?month=${thisMonth}&client=${companyRelationshipId}`);
  await admin.waitForTimeout(3000);
  const lines = psql(`select string_agg(l.description, ' | ') from "InvoiceLine" l join "Invoice" i on i.id=l."invoiceId" where i."companyRelationshipId"='${companyRelationshipId}' and l."shiftId" is not null;`);
  log("請求書には接客だけが載り、研修（請求なし）は載らない", lines.includes("接客") && !lines.includes("研修"));
  log("単価未設定の注意は出ない", !(await admin.locator("body").innerText()).includes("単価未設定のため明細に計上されていないシフトがあります"));

  console.log(process.exitCode ? "NO CHARGE RATE SMOKE TEST HAD FAILURES" : "NO CHARGE RATE SMOKE TEST PASSED");
} catch (e) {
  console.error(e);
  await admin.screenshot({ path: "/tmp/nocharge-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
