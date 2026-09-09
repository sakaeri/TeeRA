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

// 給料計算・請求書の対象月選択を、従来の「日付ピッカー＋開くボタン」から
// カレンダー/詳細パネルと同じ「＜ 年月 ＞」矢印形式に統一した変更の検証:
// - 矢印クリックだけで（開くボタン無しで）月が切り替わり、選択中の
//   スタッフ/依頼主は保持される
// - 中央の年月ラベルをクリックすると当月に戻る
// - 無料プランでカットオフ月に達すると「＜」が無効化される
// - スタッフ/依頼主セレクトを変更すると即座に反映される（開くボタン不要）

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
function jstPartsMonthsAgo(monthsAgo) {
  const now = new Date(Date.now() + JST_OFFSET_MS);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}
const today = jstPartsMonthsAgo(0);
const cutoff = jstPartsMonthsAgo(2);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminEmail = `monthnav-admin-${Date.now()}@example.com`;
const staffEmail = `monthnav-staff-${Date.now()}@example.com`;
const companyName = `対象月ナビ確認株式会社${Date.now()}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "対象月ナビ確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}' order by "createdAt" desc limit 1;`);

  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "対象月ナビ確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // --- 給料計算: 矢印だけで月が切り替わり、スタッフ選択が保持される ---
  await admin.goto(`http://localhost:3000/company/payroll?staff=${staffUserId}`);
  await admin.waitForTimeout(300);
  let body = await admin.textContent("body");
  log("開くボタンはもう無い", !body.includes("開く"));
  log("当月の年月ラベルが表示される", body.includes(`${today.year}年${today.month}月`));

  await admin.getByRole("button", { name: "前の月" }).click();
  await admin.waitForTimeout(300);
  let url = new URL(admin.url());
  const prevYm = jstPartsMonthsAgo(1);
  log("「前の月」クリックだけで前月のURLに遷移する", url.searchParams.get("month") === `${prevYm.year}-${String(prevYm.month).padStart(2, "0")}`);
  log("前の月に移動してもスタッフ選択が保持される", url.searchParams.get("staff") === staffUserId);

  await admin.getByRole("button", { name: "当月に戻る" }).click();
  await admin.waitForTimeout(300);
  url = new URL(admin.url());
  log("中央の年月ラベルをクリックすると当月に戻る", url.searchParams.get("month") === `${today.year}-${String(today.month).padStart(2, "0")}`);

  // --- スタッフ選択を変更すると即座に反映される ---
  await admin.locator("select").selectOption(staffUserId);
  await admin.waitForTimeout(300);
  body = await admin.textContent("body");
  log("スタッフ選択の変更が開くボタン無しで反映される（計算画面が出る）", body.includes("勤務内訳"));

  // --- カットオフ月では「前の月」が無効化される ---
  for (let i = 0; i < 2; i++) {
    await admin.getByRole("button", { name: "前の月" }).click();
    await admin.waitForTimeout(300);
  }
  body = await admin.textContent("body");
  log("給料計算でもカットオフ月（当月-2）に到達する", body.includes(`${cutoff.year}年${cutoff.month}月`));
  const payrollPrevDisabled = await admin.getByRole("button", { name: "前の月" }).isDisabled();
  log("給料計算のカットオフ月では「前の月」が無効化される", payrollPrevDisabled);

  // --- 請求書: 同様の検証（agencyモジュール有効化＋代理クライアント作成） ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加する");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "対象月ナビ確認取引先");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);
  const relationshipId = psql(
    `select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' order by "createdAt" desc limit 1;`,
  );

  await admin.goto(`http://localhost:3000/company/invoices?client=${relationshipId}`);
  await admin.waitForTimeout(300);
  body = await admin.textContent("body");
  log("請求書にも開くボタンは無い", !body.includes("開く"));

  await admin.getByRole("button", { name: "前の月" }).click();
  await admin.waitForTimeout(300);
  url = new URL(admin.url());
  log("請求書でも「前の月」クリックだけで前月に遷移し、依頼主選択が保持される", url.searchParams.get("client") === relationshipId);

  console.log(process.exitCode ? "PAYROLL/INVOICES MONTH NAV SMOKE TEST HAD FAILURES" : "PAYROLL/INVOICES MONTH NAV SMOKE TEST PASSED");
} catch (err) {
  console.error("PAYROLL/INVOICES MONTH NAV SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
