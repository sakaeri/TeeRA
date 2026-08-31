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
const admin = await (await browser.newContext()).newPage();
const staffA = await (await browser.newContext()).newPage();
const staffC = await (await browser.newContext()).newPage();

const adminEmail = `consent-admin-${Date.now()}@example.com`;
const staffAEmail = `consent-staffa-${Date.now()}@example.com`;
const staffCEmail = `consent-staffc-${Date.now()}@example.com`;

async function inviteAndJoin(page, name, email) {
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await page.goto(inviteUrl);
  await page.click("text=アカウントを作成して参加する");
  await page.fill("#name", name);
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL(new RegExp("/invite/"));
  await page.click("text=参加する");
  await page.waitForURL("http://localhost:3000/staff");
  return psql(`select id from "User" where email='${email}';`);
}

async function generateContract(staffName) {
  await admin.goto("http://localhost:3000/company/roster");
  await admin.reload();
  await admin.waitForTimeout(500);
  await admin.locator("tbody tr", { hasText: staffName }).click();
  await admin.waitForTimeout(300);
  const panel = admin.locator("div.fixed.inset-0.z-30").first();
  await panel.getByRole("button", { name: "契約書管理" }).click();
  await panel.getByRole("button", { name: "＋契約書を生成" }).click();
  await admin.waitForTimeout(200);
  const choose = admin.locator("div.fixed.inset-0.z-30").last();
  await choose.locator("select").selectOption({ label: "アルバイト・キャディ業務" });
  await choose.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  const assign = admin.locator("div.fixed.inset-0.z-30").last();
  await assign.getByRole("button", { name: "このテンプレートのまま契約する" }).click();
  await admin.waitForTimeout(700);
}

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "同意フロー管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "同意フロー株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='同意フロー株式会社';`);

  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("キャディ業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("DAILY");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("9000");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);

  const staffAUserId = await inviteAndJoin(staffA, "同意花子", staffAEmail);
  const staffCUserId = await inviteAndJoin(staffC, "同意次郎", staffCEmail);

  // staffC already has ID docs on file (rehire-style scenario) but no bank info yet
  psql(
    `update "CompanyMembership" set "idDocumentFrontUrl"='https://example.com/front.png', "idDocumentBackUrl"='https://example.com/back.png' ` +
      `where "userId"='${staffCUserId}';`,
  );

  // --- staff A: fresh, nothing on file
  await generateContract("同意花子");
  const statusAfterGenerate = psql(`select status from "StaffContract" where "staffUserId"='${staffAUserId}';`);
  log("生成直後はACTIVEではなくPENDING_CONSENT（本人の同意待ち）", statusAfterGenerate === "PENDING_CONSENT");

  // シフト日付は"current_date"を仮定せず、実際に生成された契約の
  // contractStartDateに合わせる（UI側はtodayJst()でデフォルト設定するため、
  // タイムゾーンの境界時刻によってはPostgresのcurrent_dateと1日ずれること
  // があり、それに引きずられて契約の対象外と判定されるのを防ぐ）。
  const contractStartDate = psql(
    `select "contractStartDate" from "StaffContract" where "staffUserId"='${staffAUserId}';`,
  );
  const shiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffAUserId}', 'INHOUSE', 'キャディ業務', '${contractStartDate}', '09:00', '17:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${shiftId}', '${staffAUserId}', 'WORKED', 'APPROVED', now() - interval '8 hour', now(), 480, now(), now());`,
  );
  const thisMonth = contractStartDate.slice(0, 7);
  await admin.goto(`http://localhost:3000/company/payroll?month=${thisMonth}&staff=${staffAUserId}`);
  await admin.waitForTimeout(600);
  const lineForPendingContract = psql(`select count(*) from "SalarySlipLine" where "shiftId"='${shiftId}';`);
  log("同意前の契約は給与計算に使われない（確定シフトがあっても明細行は作られない）", lineForPendingContract === "0");

  await staffA.goto("http://localhost:3000/staff/contracts");
  await staffA.waitForTimeout(500);
  let bodyA = await staffA.textContent("body");
  log("スタッフ側に「新しい契約書があります」ウィザードが表示される", bodyA.includes("新しい契約書があります") && bodyA.includes("① 契約内容を確認"));

  await staffA.getByRole("button", { name: "契約書の全文を確認する" }).click();
  await staffA.waitForTimeout(300);
  bodyA = await staffA.textContent("body");
  log("全文確認ポップアップが開く（読み取り専用）", bodyA.includes("キャディ業務"));
  await staffA.getByRole("button", { name: "✕" }).click();
  await staffA.waitForTimeout(200);

  await staffA.getByRole("button", { name: "内容を確認しました（同意する）" }).click();
  await staffA.waitForTimeout(600);

  const statusAfterConsent = psql(
    `select status || '|' || ("consentedAt" is not null)::text from "StaffContract" where "staffUserId"='${staffAUserId}';`,
  );
  log("同意ボタンでACTIVEになり、同意日時が記録される", statusAfterConsent === "ACTIVE|true");

  bodyA = await staffA.textContent("body");
  log("同意後は自動的に② 本人確認書類のステップに進む（未提出のため）", bodyA.includes("② 本人確認書類を提出"));
  log("本人確認書類が未提出のうちは「次へ」が無効", await staffA.getByRole("button", { name: "次へ" }).isDisabled());

  await admin.goto(`http://localhost:3000/company/payroll?month=${thisMonth}&staff=${staffAUserId}`);
  await admin.waitForTimeout(600);
  const lineAfterConsent = psql(
    `select json_build_object('rate', rate, 'amount', amount) from "SalarySlipLine" where "shiftId"='${shiftId}';`,
  );
  const parsedLine = lineAfterConsent ? JSON.parse(lineAfterConsent) : null;
  log(
    "同意後は給与計算にちゃんと使われる（日給9000円）",
    parsedLine && Number(parsedLine.rate) === 9000 && Number(parsedLine.amount) === 9000,
  );

  // --- staff C: ID docs already on file (rehire-style) but no bank info yet
  await generateContract("同意次郎");
  await staffC.goto("http://localhost:3000/staff/contracts");
  await staffC.waitForTimeout(500);
  await staffC.getByRole("button", { name: "内容を確認しました（同意する）" }).click();
  await staffC.waitForTimeout(600);

  let bodyC = await staffC.textContent("body");
  log("本人確認書類が既に登録済みなら②はスキップされ③振込先情報に進む", bodyC.includes("③ 振込先情報を入力") && !bodyC.includes("② 本人確認書類を提出"));

  const wizardC = staffC.locator("section.border-primary");
  await wizardC.locator('label:has-text("銀行名") input').fill("同意銀行");
  await wizardC.locator('label:has-text("口座番号") input').fill("7654321");
  await wizardC.locator('label:has-text("口座名義") input').fill("ドウイ ジロウ");
  await wizardC.getByRole("button", { name: "次へ" }).click();
  await staffC.waitForTimeout(500);

  const bankAfterSave = psql(`select "bankName" || '|' || "accountNumber" from "CompanyMembership" where "userId"='${staffCUserId}';`);
  log("振込先情報が保存される", bankAfterSave === "同意銀行|7654321");

  bodyC = await staffC.textContent("body");
  log("振込先を入力すると④ 完了ステップに進む", bodyC.includes("④ 完了") && bodyC.includes("お疲れ様でした"));

  await staffC.getByRole("button", { name: "閉じる" }).click();
  await staffC.waitForTimeout(300);
  bodyC = await staffC.textContent("body");
  log(
    "ウィザードを閉じると通常の画面に戻る（契約中の雇用契約書に表示される）",
    bodyC.includes("契約中の雇用契約書") && !bodyC.includes("新しい契約書があります"),
  );

  console.log(process.exitCode ? "CONTRACT CONSENT FLOW SMOKE TEST HAD FAILURES" : "CONTRACT CONSENT FLOW SMOKE TEST PASSED");
} catch (err) {
  console.error("CONTRACT CONSENT FLOW SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-consent-admin-failure.png" });
  await staffA.screenshot({ path: "/tmp/smoke-consent-staffa-failure.png" });
  await staffC.screenshot({ path: "/tmp/smoke-consent-staffc-failure.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
