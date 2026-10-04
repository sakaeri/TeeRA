import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

// 控除欄の修正を検証する:
// ①先頭の0が消えずに残り続けるバグ（value制御+number inputの既知の癖）
//   を、他の金額欄と同じdefaultValue+onBlurの非制御方式に直したことの確認。
// ②雇用保険料欄に率(%)を入力すると、支給合計×率で自動計算されることの
//   確認（率自体はその月の表示用に保存され、再読み込みでも残る）。
//   金額欄は率モードでは個別入力にせず「0.6%（＝78円）」の読み取り専用
//   表示にし、率を消すと手入力モードに戻る。
// ③支給合計（勤務内訳）を編集すると、率モードの雇用保険料も自動で
//   再計算されることの確認（以前は率欄を消して入れ直すまで古い支給合計
//   ベースの金額のままになるバグがあった）。

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

const suffix = Date.now();
const adminEmail = `prded-admin-${suffix}@example.com`;
const staffEmail = `prded-staff-${suffix}@example.com`;
const today = new Date().toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "控除確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "控除確認株式会社" + suffix);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "控除確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("レジ業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1300");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);

  const payrollStaffUserId = psql(`select id from "User" where email='${staffEmail}';`);
  const templateId = psql(`select id from "ContractTemplate" where "companyId" in (select id from "Company" where name='控除確認株式会社${suffix}') order by "createdAt" desc limit 1;`);
  const wageAmount = psql(`select "wageAmount" from "ContractTemplate" where id='${templateId}';`);
  const staffContractId = psql(
    `with ins as (insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", "contractStartDate", status, "consentedAt", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${templateId}', '${payrollStaffUserId}', ${wageAmount}, current_date - interval '7 day', 'ACTIVE', now(), now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "StaffContractWageVersion" (id, "staffContractId", "wageAmount", "effectiveFrom", "createdAt") ` +
      `values (gen_random_uuid()::text, '${staffContractId}', ${wageAmount}, current_date - interval '7 day', now());`,
  );
  psql(`update "ContractTemplate" set status='LOCKED' where id='${templateId}';`);

  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  const assignModal1 = admin.locator("div.fixed.inset-0.z-20").last();
  await assignModal1.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await assignModal1.getByRole("button", { name: "＋ 新しい業務内容を追加する" }).click();
  await assignModal1.locator('input[placeholder*="業務内容"]').fill("通常業務");
  await assignModal1.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal1.getByRole("button", { name: "控除確認スタッフ" }).click();
  await assignModal1.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal1.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  const shiftId = psql(`select id from "Shift" where "staffUserId"='${payrollStaffUserId}' order by "createdAt" desc limit 1;`);

  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.getByRole("button", { name: "勤務開始" }).click();
  await staff.waitForTimeout(500);
  psql(`update "WorkReport" set "clockIn" = now() - interval '10 hours' where "shiftId"='${shiftId}';`);
  await staff.getByRole("button", { name: "勤務終了" }).click();
  await staff.waitForTimeout(500);
  await staff.getByRole("button", { name: "業務報告を提出する" }).click();
  await staff.waitForTimeout(600);

  await admin.goto("http://localhost:3000/company/settings?tab=workreports");
  await admin.getByRole("button", { name: "承認する" }).click();
  await admin.waitForTimeout(600);

  const payrollUrl = `http://localhost:3000/company/payroll?month=${thisMonth}&staff=${payrollStaffUserId}`;
  await admin.goto(payrollUrl);
  await admin.waitForTimeout(500);
  // 支給合計は 10h × 1300円 = 13000円 のはず
  let body = await admin.locator("body").innerText();
  log("支給合計が13,000円になっている", body.includes("支給合計 13000円") || body.includes("支給合計 13,000円"));

  // --- ①先頭の0が残るバグの確認: 社会保険料欄に8900と入力する ---
  // 社会保険料は率欄が無い行なので、控除セクション内の最初のnumber inputが
  // その金額欄になる。
  const firstDeductionAmountInput = admin.locator("section", { hasText: "控除" }).locator("input[type=number]").first();
  await firstDeductionAmountInput.click();
  await firstDeductionAmountInput.fill("");
  await firstDeductionAmountInput.type("8900");
  await firstDeductionAmountInput.blur();
  await admin.waitForTimeout(500);
  const socialInsuranceValue = await firstDeductionAmountInput.inputValue();
  log("社会保険料に8900と入力すると08900にならず8900のまま", socialInsuranceValue === "8900");

  // --- ②雇用保険料: 率を入力すると自動計算される ---
  // （率モードでは個別の金額入力欄は出さず、「0.6%（＝78円）」のように
  //   計算結果だけを表示する仕様に変更した）
  const insuranceRow = admin.locator("div", { hasText: "雇用保険料" }).last();
  const rateInput = insuranceRow.locator('input[placeholder="率"]');
  await rateInput.fill("0.6");
  await rateInput.blur();
  await admin.waitForTimeout(500);
  // 13000 × 0.6 / 100 = 78円
  let insuranceRowText = await insuranceRow.innerText();
  log("雇用保険料率0.6%を入力すると支給合計13000円×0.6%=78円が自動計算される", insuranceRowText.includes("％（＝78円）") || insuranceRowText.includes("%（＝78円）"));
  log("「×支給合計 =」という冗長な文言は出ない", !insuranceRowText.includes("×支給合計"));

  const slipId = psql(`select id from "SalarySlip" where "staffUserId"='${payrollStaffUserId}';`);
  const deductionsJson = psql(`select "deductions"::text from "SalarySlip" where id='${slipId}';`);
  log("DB上にratePercent=0.6が保存される", /"ratePercent":\s*0\.6/.test(deductionsJson));
  log("DB上に金額78も保存される", /"id":\s*"fixed-2".*?"amount":\s*78/.test(deductionsJson));

  // ページを開き直しても率が再表示される
  await admin.goto(payrollUrl);
  await admin.waitForTimeout(500);
  const insuranceRowAfterReload = admin.locator("div", { hasText: "雇用保険料" }).last();
  const rateInputAfterReload = insuranceRowAfterReload.locator('input[placeholder="率"]');
  const rateValueAfterReload = await rateInputAfterReload.inputValue();
  log("ページを開き直しても率0.6が再表示される", rateValueAfterReload === "0.6");

  // --- ③支給合計が変わると（勤務内訳を編集すると）雇用保険料も自動で
  //     再計算される（以前は率欄を消して入れ直すまで古い金額のままの
  //     バグがあった） ---
  const lineAmountInputs = admin.locator('section:has(h2:has-text("勤務内訳")) input[type=number]');
  await lineAmountInputs.nth(1).fill("2600"); // 単価を2倍（1300→2600）にする
  await lineAmountInputs.nth(1).blur();
  await admin.waitForTimeout(800);
  let bodyAfterGrossChange = await admin.locator("body").innerText();
  log("支給合計が26000円に再計算される", bodyAfterGrossChange.includes("支給合計 26000円"));
  log("雇用保険料も自動で156円（26000×0.6%）に再計算される（バグ修正確認）", bodyAfterGrossChange.includes("％（＝156円）") || bodyAfterGrossChange.includes("%（＝156円）"));
  // 元の単価に戻しておく（以降のassertionは13000円ベースの想定のため）
  await lineAmountInputs.nth(1).fill("1300");
  await lineAmountInputs.nth(1).blur();
  await admin.waitForTimeout(800);

  // --- 率欄を空にすると手入力の金額モードに切り替わる ---
  const rateInputToClear = admin.locator("div", { hasText: "雇用保険料" }).last().locator('input[placeholder="率"]');
  await rateInputToClear.fill("");
  await rateInputToClear.blur();
  await admin.waitForTimeout(500);
  await admin.goto(payrollUrl);
  await admin.waitForTimeout(500);
  const insuranceRowAfterClear = admin.locator("div", { hasText: "雇用保険料" }).last();
  const rateValueAfterClear = await insuranceRowAfterClear.locator('input[placeholder="率"]').inputValue();
  log("率欄を空にすると率表示はクリアされる（空になる）", rateValueAfterClear === "");

  // --- 手入力モードになった金額欄を直接上書きできる ---
  const insuranceAmountInputAfterClear = insuranceRowAfterClear.locator('input[type=number]').last();
  await insuranceAmountInputAfterClear.click();
  await insuranceAmountInputAfterClear.fill("");
  await insuranceAmountInputAfterClear.type("100");
  await insuranceAmountInputAfterClear.blur();
  await admin.waitForTimeout(500);
  await admin.goto(payrollUrl);
  await admin.waitForTimeout(500);
  const insuranceRowAfterOverride = admin.locator("div", { hasText: "雇用保険料" }).last();
  const amountValueAfterOverride = await insuranceRowAfterOverride.locator('input[type=number]').last().inputValue();
  log("直接上書きした金額100円は保持される", amountValueAfterOverride === "100");

  console.log(process.exitCode ? "PAYROLL DEDUCTIONS SMOKE TEST HAD FAILURES" : "PAYROLL DEDUCTIONS SMOKE TEST PASSED");
} catch (err) {
  console.error("PAYROLL DEDUCTIONS SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-payroll-deductions-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
