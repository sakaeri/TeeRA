import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// スタッフが「勤務先キャンセル」と報告した依頼主の現場のシフト：
// ・承認すると、規定から出た金額でキャンセル料を記録し「確認待ち」にする（業務報告の詳細に出る）
// ・やることに「勤務先キャンセルでした（キャンセル料を確認）」が出て、その場で金額を決められる
// ・決めた後も、業務報告の詳細から金額を変えられる

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

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const suffix = Date.now();
const companyName = `キャンセル料確認株式会社${suffix}`;
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "キャンセル料管理者");
  await page.fill("#email", `cancel-fee-admin-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  psql(`update "Company" set "agencyEnabled" = true where id = '${companyId}';`);
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") values (gen_random_uuid()::text, '${companyId}', '${companyId}', 'キャンセルゴルフ場', 'ACTIVE', now()) returning id) select id from ins;`,
  );
  const staffId = psql(
    `with ins as (insert into "User" (id, email, name, "createdAt", "updatedAt") values (gen_random_uuid()::text, 'cancel-fee-staff-${suffix}@example.com', 'キャンセル報告スタッフ', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "CompanyMembership" (id, "userId", "companyId", role, "createdAt") values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF', now());`,
  );
  const shiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", "companyRelationshipId", source, date, "startTime", "endTime", "taskName", "createdVia", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', '${relId}', 'CLIENT', '${today}', '08:00', '17:00', 'キャディ', 'ASSIGN', now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "computedMinutes", "approvalStatus", "submittedAt", "updatedAt") values (gen_random_uuid()::text, '${shiftId}', '${staffId}', 'CANCELLED_BY_EMPLOYER', 0, 'PENDING', now(), now());`,
  );

  // 業務内容が入っていないシフト（単価が決まらず請求書に載らない）は「業務内容なし」と目立たせる
  const noTaskShift = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", "companyRelationshipId", source, date, "startTime", "endTime", "createdVia", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', '${relId}', 'CLIENT', '${today}', '08:00', '17:00', 'ASSIGN', now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "computedMinutes", "approvalStatus", "submittedAt", "updatedAt") values (gen_random_uuid()::text, '${noTaskShift}', '${staffId}', 'WORKED', 480, 'PENDING', now(), now());`,
  );
  await page.goto(`http://localhost:3000/company/roster?client=${relId}`);
  await page.getByTestId("missing-task-name").first().waitFor({ timeout: 15000 });
  log("依頼主の稼働履歴で、業務内容が無い行に「業務内容なし」と出る", (await page.getByTestId("missing-task-name").count()) === 1);

  // 依頼主の詳細から業務報告の詳細を開いて承認する
  await page.goto(`http://localhost:3000/company/roster?client=${relId}`);
  await page.getByRole("button", { name: /キャンセル報告スタッフ/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "業務報告の詳細" });
  await dialog.waitFor();
  page.once("dialog", (d) => d.accept());
  await dialog.getByRole("button", { name: "承認する" }).first().click();
  const feeRow = dialog.getByTestId("report-cancellation-fee");
  await feeRow.waitFor({ timeout: 15000 });
  log("承認すると、キャンセル料を「確認待ち」で記録する", psql(`select "feeReviewPending"||'|'||source from "ShiftCancellation" where "shiftId"='${shiftId}';`) === "true|STAFF_REPORTED");
  log("業務報告の詳細に「キャンセル料：なし（確認待ち）」と「確認する」が出る", /キャンセル料：なし（確認待ち）/.test(await feeRow.innerText()) && (await feeRow.getByRole("button", { name: "確認する" }).count()) === 1);

  // やることから決める
  await page.goto("http://localhost:3000/company");
  const todo = page.getByTestId("transfer-fee-todo").filter({ hasText: "勤務先キャンセル" });
  await todo.first().waitFor({ timeout: 15000 });
  log("やることに「勤務先キャンセルでした（キャンセル料を確認）」が出る", (await todo.innerText()).includes("キャンセル料を確認"));
  await todo.first().click();
  const modal = page.getByTestId("transfer-fee-modal");
  await modal.waitFor();
  log("ポップアップに「勤務先のキャンセルで休みになった」と出る", (await modal.innerText()).includes("勤務先のキャンセルで休みになったと報告がありました"));
  await page.getByTestId("transfer-fee-input").fill("3000");
  await modal.getByRole("button", { name: "この金額で記録する" }).click();
  await modal.waitFor({ state: "detached" });
  await page.waitForTimeout(1200);
  log("記録すると確認待ちが外れる", psql(`select "feeAmount"||'|'||"feeReviewPending" from "ShiftCancellation" where "shiftId"='${shiftId}';`) === "3000|false");
  log("やることから消える", (await page.getByTestId("transfer-fee-todo").count()) === 0);

  // 決めた後も、業務報告の詳細から変えられる
  await page.goto(`http://localhost:3000/company/roster?client=${relId}`);
  await page.getByRole("button", { name: /キャンセル報告スタッフ/ }).first().click();
  const row2 = page.getByRole("dialog", { name: "業務報告の詳細" }).getByTestId("report-cancellation-fee");
  await row2.waitFor();
  log("詳細に「3,000円」と「変える」が出る", (await row2.innerText()).includes("3,000円") && (await row2.getByRole("button", { name: "変える" }).count()) === 1);
  await row2.getByRole("button", { name: "変える" }).click();
  const modal2 = page.getByTestId("transfer-fee-modal");
  await modal2.waitFor();
  log("開き直すと今の金額が入っている", (await page.getByTestId("transfer-fee-input").inputValue()) === "3000");
  await modal2.getByRole("button", { name: "キャンセル料なし" }).click();
  await modal2.waitFor({ state: "detached" });
  await page.waitForTimeout(1000);
  log("「キャンセル料なし」に変えられる", psql(`select "feeAmount" from "ShiftCancellation" where "shiftId"='${shiftId}';`) === "0");
  log("詳細の表示も「なし」になる", (await row2.innerText()).includes("キャンセル料：なし"));

  console.log(process.exitCode ? "STAFF CANCEL FEE SMOKE TEST HAD FAILURES" : "STAFF CANCEL FEE SMOKE TEST PASSED");
} catch (e) {
  console.error("STAFF CANCEL FEE SMOKE TEST FAILED", e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
