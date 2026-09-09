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

// 無料プランの過去データ3ヶ月制限（当月＋過去2ヶ月まで）の検証:
// - カレンダー/給料計算/請求書のいずれも、制限より前の月を直接URLで
//   指定するとカットオフ月へリダイレクトされる
// - 発行履歴一覧からも制限より前の月の行が消える
// - スタンダードへアップグレードするとその場で（グランドファザリング
//   なしに）同じデータが見えるようになる
// - スタッフ詳細パネルの稼働履歴タブでも、カットオフ月で「前の月」が
//   無効化され、注記が出る

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
function jstPartsMonthsAgo(monthsAgo) {
  const now = new Date(Date.now() + JST_OFFSET_MS);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}
function monthStr({ year, month }) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

const cutoff = jstPartsMonthsAgo(2); // 無料プランでの下限月（当月-2）
const farPast = jstPartsMonthsAgo(5); // カットオフより前の月

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminEmail = `history-admin-${Date.now()}@example.com`;
const staffEmail = `history-staff-${Date.now()}@example.com`;
const companyName = `過去データ制限確認株式会社${Date.now()}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "過去データ制限確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}' order by "createdAt" desc limit 1;`);

  // スタッフを1名招待（給与明細/スタッフ詳細パネルのテスト用）
  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "過去データ制限確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // 5ヶ月前の給与明細（発行済み）をpsqlで仕込む
  const farPastMonth = monthStr(farPast);
  const salarySlipId = psql(
    `with ins as (insert into "SalarySlip" (id, "companyId", "staffUserId", "targetMonth", status, "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', '${farPastMonth}', 'ISSUED', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "SalarySlipIssue" (id, "salarySlipId", snapshot, "chargedTee", "issuedAt") ` +
      `values (gen_random_uuid()::text, '${salarySlipId}', '{}'::jsonb, true, now());`,
  );

  // agencyモジュール有効化＋代理クライアントを1件作成し、5ヶ月前の請求書
  // （発行済み）をpsqlで仕込む
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加する");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "過去データ制限確認取引先");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);
  const relationshipId = psql(
    `select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' order by "createdAt" desc limit 1;`,
  );
  log("代理クライアントの取引先が作成された", Boolean(relationshipId));

  const invoiceId = psql(
    `with ins as (insert into "Invoice" (id, "issuingCompanyId", "companyRelationshipId", "periodLabel", status, "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${relationshipId}', '${farPastMonth}', 'ISSUED', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "InvoiceIssue" (id, "invoiceId", snapshot, "issuedAt") ` +
      `values (gen_random_uuid()::text, '${invoiceId}', '{}'::jsonb, now());`,
  );

  // --- カレンダー: 無料プランでカットオフより前の月を直接指定するとリダイレクトされる ---
  await admin.goto(`http://localhost:3000/company/calendar?y=${farPast.year}&m=${farPast.month}`);
  await admin.waitForTimeout(300);
  let url = new URL(admin.url());
  log(
    "カレンダーで5ヶ月前を指定するとカットオフ月へリダイレクトされる",
    url.searchParams.get("y") === String(cutoff.year) && url.searchParams.get("m") === String(cutoff.month),
  );

  // --- 給料計算: カットオフより前の月を指定するとリダイレクトされる ---
  await admin.goto(`http://localhost:3000/company/payroll?month=${farPastMonth}&staff=${staffUserId}`);
  await admin.waitForTimeout(300);
  url = new URL(admin.url());
  log("給料計算で5ヶ月前を指定するとカットオフ月へリダイレクトされる", url.searchParams.get("month") === monthStr(cutoff));

  await admin.goto("http://localhost:3000/company/payroll");
  await admin.waitForTimeout(300);
  let bodyText = await admin.textContent("body");
  log("給料計算の発行履歴に5ヶ月前の明細は表示されない（無料プラン）", !bodyText.includes(`${farPast.year}年${farPast.month}月`));
  log("通常の対象月を見ている時は制限バナーが出ない（無料プランというだけで常時出ると邪魔）", !bodyText.includes("直近3ヶ月まで"));

  await admin.goto(`http://localhost:3000/company/payroll?month=${monthStr(cutoff)}&staff=${staffUserId}`);
  await admin.waitForTimeout(300);
  bodyText = await admin.textContent("body");
  log("給料計算でカットオフ月そのものを見ている時は制限バナーが表示される", bodyText.includes("直近3ヶ月まで"));
  log("制限バナーにプランアップグレードへの導線がある", await admin.getByRole("link", { name: "プランをアップグレードする" }).isVisible());
  await admin.getByRole("link", { name: "プランをアップグレードする" }).click();
  await admin.waitForURL("http://localhost:3000/company/wallet");
  log("導線をクリックするとTee残高ページに遷移する", admin.url() === "http://localhost:3000/company/wallet");

  // --- 請求書: カットオフより前の月を指定するとリダイレクトされる ---
  await admin.goto(`http://localhost:3000/company/invoices?month=${farPastMonth}&client=${relationshipId}`);
  await admin.waitForTimeout(300);
  url = new URL(admin.url());
  log("請求書で5ヶ月前を指定するとカットオフ月へリダイレクトされる", url.searchParams.get("month") === monthStr(cutoff));

  await admin.goto("http://localhost:3000/company/invoices");
  await admin.waitForTimeout(300);
  bodyText = await admin.textContent("body");
  log("請求書の発行履歴に5ヶ月前の請求書は表示されない（無料プラン）", !bodyText.includes(`${farPast.year}年${farPast.month}月`));
  log("通常の対象月を見ている時は請求書にも制限バナーが出ない", !bodyText.includes("直近3ヶ月まで"));

  await admin.goto(`http://localhost:3000/company/invoices?month=${monthStr(cutoff)}&client=${relationshipId}`);
  await admin.waitForTimeout(300);
  bodyText = await admin.textContent("body");
  log("請求書でカットオフ月そのものを見ている時は制限バナーが表示される", bodyText.includes("直近3ヶ月まで"));

  // --- スタッフ詳細パネル: カットオフ月で「前の月」が無効化される ---
  await admin.goto(`http://localhost:3000/company/roster?staff=${staffUserId}`);
  await admin.waitForTimeout(400);
  await admin.getByRole("button", { name: "前の月" }).click();
  await admin.waitForTimeout(300);
  await admin.getByRole("button", { name: "前の月" }).click();
  await admin.waitForTimeout(300);
  bodyText = await admin.textContent("body");
  log("スタッフ詳細パネルがカットオフ月（当月-2）に到達する", bodyText.includes(`${cutoff.year}年${cutoff.month}月`));
  log("カットオフ月では制限バナーが表示される", bodyText.includes("直近3ヶ月まで"));
  const prevButtonDisabledAtCutoff = await admin.getByRole("button", { name: "前の月" }).isDisabled();
  log("カットオフ月では「前の月」ボタンが無効化される", prevButtonDisabledAtCutoff);

  // --- スタンダードへアップグレードすると、その場で制限が外れる ---
  psql(`update "Company" set "planTier" = 'STANDARD' where id = '${companyId}';`);

  await admin.goto(`http://localhost:3000/company/calendar?y=${farPast.year}&m=${farPast.month}`);
  await admin.waitForTimeout(300);
  url = new URL(admin.url());
  log(
    "スタンダードプランではカレンダーで5ヶ月前を指定してもリダイレクトされない",
    url.searchParams.get("y") === String(farPast.year) && url.searchParams.get("m") === String(farPast.month),
  );

  // 発行履歴は月ナビで表示中の月だけを対象にする設計になったため、5ヶ月前
  // そのものを対象月として開き、そこに履歴が表示されること（＝リダイレクト
  // もされずアクセスできること）を確認する。
  await admin.goto(`http://localhost:3000/company/payroll?month=${farPastMonth}`);
  await admin.waitForTimeout(300);
  bodyText = await admin.textContent("body");
  log("スタンダードプランでは給料計算で5ヶ月前を対象月にしても発行履歴に表示される", bodyText.includes("過去データ制限確認スタッフ"));
  log("スタンダードプランでは制限バナーが表示されない", !bodyText.includes("直近3ヶ月まで"));

  await admin.goto(`http://localhost:3000/company/invoices?month=${farPastMonth}`);
  await admin.waitForTimeout(300);
  bodyText = await admin.textContent("body");
  log("スタンダードプランでは請求書で5ヶ月前を対象月にしても発行履歴に表示される", bodyText.includes("過去データ制限確認取引先"));

  await admin.goto(`http://localhost:3000/company/roster?staff=${staffUserId}`);
  await admin.waitForTimeout(400);
  await admin.getByRole("button", { name: "前の月" }).click();
  await admin.waitForTimeout(300);
  await admin.getByRole("button", { name: "前の月" }).click();
  await admin.waitForTimeout(300);
  await admin.getByRole("button", { name: "前の月" }).click();
  await admin.waitForTimeout(300);
  bodyText = await admin.textContent("body");
  log("スタンダードプランではスタッフ詳細パネルでカットオフ月を越えて遡れる", !bodyText.includes("直近3ヶ月まで"));

  console.log(process.exitCode ? "PLAN HISTORY CUTOFF SMOKE TEST HAD FAILURES" : "PLAN HISTORY CUTOFF SMOKE TEST PASSED");
} catch (err) {
  console.error("PLAN HISTORY CUTOFF SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
