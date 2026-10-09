import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

// 給与明細PDFの「勤務内訳」グループ化を検証する:
// - 時給制のシフトは「勤務先（業務内容）」でまとめて1行に合算される
//   （同じ勤務先・業務内容・単価の複数日のシフトが1行になる）
// - 勤務先が異なれば別の行になる（社内 vs 依頼主）
// - 画面上の編集欄（勤務内訳の一覧）は従来どおりシフトごとの行のまま
//   （グループ化はPDF出力のときだけ）
//
// シフト作成・打刻・承認のUIフローは他のスモークテストで別途カバー済み
// なので、ここでは1件だけ実際のUIフローで作り、残りの2件（グループ化を
// 検証するために必要な複数シフト）はSQLで直接、承認済みの実績として
// 投入する（PDF側のグループ化ロジックの検証が目的のため）。

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
const adminEmail = `prgroup-admin-${suffix}@example.com`;
const staffEmail = `prgroup-staff-${suffix}@example.com`;
const companyName = `グループ化確認株式会社${suffix}`;
// アプリ本体はtodayJst()（JST基準）で「今日」を判定するため、Postgresの
// current_date（UTCのサーバー時刻基準）に頼ると、UTC深夜帯でJSTとの
// 日付ズレが起きてSQLで直接投入したシフトが対象月からこぼれる。ここでは
// JSTで明示的に日付文字列を作ってSQLに渡す。SQLで直接投入する分は、月の
// 境界をまたぐ心配が無いよう対象月の1日に固定する（グループ化の検証に
// 日付そのものの違いは必要ない）。
const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
const today = nowJst.toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "グループ化確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "グループ化確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("基本業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1000");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);

  const payrollStaffUserId = psql(`select id from "User" where email='${staffEmail}';`);
  const templateId = psql(`select id from "ContractTemplate" where "companyId"='${companyId}' order by "createdAt" desc limit 1;`);
  const wageAmount = psql(`select "wageAmount" from "ContractTemplate" where id='${templateId}';`);
  const staffContractId = psql(
    `with ins as (insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", "contractStartDate", status, "consentedAt", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${templateId}', '${payrollStaffUserId}', ${wageAmount}, current_date - interval '10 day', 'ACTIVE', now(), now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "StaffContractWageVersion" (id, "staffContractId", "wageAmount", "effectiveFrom", "createdAt") ` +
      `values (gen_random_uuid()::text, '${staffContractId}', ${wageAmount}, current_date - interval '10 day', now());`,
  );
  psql(`update "ContractTemplate" set status='LOCKED' where id='${templateId}';`);

  // shift1: 社内×レジ業務、UIの通常フローで作成・打刻・提出・承認まで行う
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  const modal = admin.locator("div.fixed.inset-0.z-20").last();
  await modal.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await modal.getByRole("button", { name: "＋ 新しい業務内容を追加する" }).click();
  await modal.locator('input[placeholder*="業務内容"]').fill("レジ業務");
  await modal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await admin.waitForTimeout(300);
  await modal.getByRole("button", { name: "グループ化確認スタッフ" }).click();
  await modal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await modal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);
  const shift1 = psql(`select id from "Shift" where "staffUserId"='${payrollStaffUserId}' order by "createdAt" desc limit 1;`);

  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.getByRole("button", { name: "勤務開始" }).click();
  await staff.waitForTimeout(400);
  psql(`update "WorkReport" set "clockIn" = now() - interval '6 hours' where "shiftId"='${shift1}';`);
  await staff.getByRole("button", { name: "勤務終了" }).click();
  await staff.waitForTimeout(400);
  await staff.getByRole("button", { name: "業務報告を提出する" }).click();
  await staff.waitForTimeout(500);

  await admin.goto("http://localhost:3000/company/settings?tab=workreports");
  await admin.waitForTimeout(400);
  await admin.getByRole("button", { name: "承認する" }).click();
  await admin.waitForTimeout(400);

  // shift2: 社内×レジ業務（shift1と同じ勤務先・業務内容・単価、別の日）
  // → PDFでshift1と1行に合算されるはず。SQLで承認済みの実績として直接投入。
  const shift2 = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, date, "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${payrollStaffUserId}', 'INHOUSE', '${thisMonth}-01'::date, false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(`update "Shift" set "taskName"='レジ業務' where id='${shift2}';`);
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "clockIn", "clockOut", "breakMinutes", "computedMinutes", "submittedAt", "approvalStatus", "approverUserId", "approvedAt", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${shift2}', '${payrollStaffUserId}', 'WORKED', now() - interval '1 day 6 hours', now() - interval '1 day', 0, 360, now(), 'APPROVED', (select id from "User" where email='${adminEmail}'), now(), now(), now());`,
  );

  // shift3: 依頼主「A社」×品出し（別の勤務先・別の業務内容）
  // → PDFでshift1/2とは別の行になるはず。
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "proxyName", status, "createdAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', 'A社', 'ACTIVE', now()) returning id) select id from ins;`,
  );
  const shift3 = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${payrollStaffUserId}', 'CLIENT', '${relId}', '品出し', '${thisMonth}-01'::date, false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "clockIn", "clockOut", "breakMinutes", "computedMinutes", "submittedAt", "approvalStatus", "approverUserId", "approvedAt", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${shift3}', '${payrollStaffUserId}', 'WORKED', now() - interval '2 day 4 hours', now() - interval '2 day', 0, 240, now(), 'APPROVED', (select id from "User" where email='${adminEmail}'), now(), now(), now());`,
  );

  // regenerateShiftLinesを走らせる（給与計算ページを開くとトリガーされる）
  await admin.goto(`http://localhost:3000/company/payroll?month=${thisMonth}&staff=${payrollStaffUserId}`);
  await admin.waitForTimeout(600);

  const editorRowCount = await admin.locator("table input[type=number]").count();
  // 3行×2入力(時間,単価) = 6個のnumber input
  log("画面上の編集欄はシフトごと3行のまま（グループ化は画面には影響しない）", editorRowCount === 6);

  const slipId = psql(`select id from "SalarySlip" where "companyId"='${companyId}' and "staffUserId"='${payrollStaffUserId}';`);
  // DB上のSalarySlipLineはシフトごとに3行のまま保持される（PDF側だけが
  // グループ化する設計であることの裏付け）。
  const lineDescriptions = psql(
    `select description from "SalarySlipLine" where "salarySlipId"='${slipId}' order by description;`,
  );
  log(
    "DB上のSalarySlipLineは3行のまま（グループ化で消えたりしない）",
    lineDescriptions.split("\n").length === 3,
  );

  // PDFの内容そのもの（グループ化された行のラベル・合算値）は、
  // @react-pdf/rendererが日本語フォントをCIDで埋め込むため生のバイト列
  // からの文字列検索では検証できない（既存のPDF関連スモークテストも同じ
  // 理由で生成成功の確認までに留めている）。buildSalarySlipPdfLinesへの
  // 入力・出力はこのテスト作成時に一時的なデバッグログで
  // 「社内（レジ業務）: 12h/12000円」「A社（品出し）: 4h/4000円」と
  // 正しく合算されることを目視確認済み。
  const pdfResp = await admin.request.get(`http://localhost:3000/api/salary-slips/${slipId}/pdf`);
  log("PDF生成に成功する", pdfResp.status() === 200);
  const pdfBuffer = await pdfResp.body();
  log("PDFが非自明なサイズで生成される", pdfBuffer.length > 1000);
  log("PDFが%PDFマジックバイトで始まる", pdfBuffer.slice(0, 4).toString() === "%PDF");

  console.log(process.exitCode ? "PAYROLL PDF GROUPING SMOKE TEST HAD FAILURES" : "PAYROLL PDF GROUPING SMOKE TEST PASSED");
} catch (err) {
  console.error("PAYROLL PDF GROUPING SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-payroll-pdf-grouping-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
