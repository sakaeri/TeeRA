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
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminEmail = `pl-admin-${Date.now()}@example.com`;
const staffEmail = `pl-staff-${Date.now()}@example.com`;
const today = new Date().toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);
const nextMonthDate = new Date(`${today}T00:00:00.000Z`);
nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
const nextMonth = nextMonthDate.toISOString().slice(0, 7);

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "有給管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "有給テスト株式会社");
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
  await staff.fill("#name", "有給スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // 有給休暇の管理UIは独立タブではなく「契約書管理」タブの中に統合されている
  await admin.goto(`http://localhost:3000/company/roster?staff=${staffUserId}`);
  await admin.click("text=契約書管理");
  await admin.waitForTimeout(300);

  // 入社日を設定すると、次回付与予定日が「入社から6ヶ月後」に自動セットされる
  // （まだ一度も付与していないため）
  await admin.locator('input[type=date]').first().fill("2020-04-01");
  await admin.getByRole("button", { name: "保存" }).first().click();
  await admin.waitForTimeout(400);
  await admin.reload();
  await admin.click("text=契約書管理");
  await admin.waitForTimeout(300);
  const hireDateAfterReload = await admin.locator('input[type=date]').first().inputValue();
  log("入社日が保存される", hireDateAfterReload === "2020-04-01");
  let body = await admin.textContent("body");
  log("次回付与予定日が入社から6ヶ月後に自動セットされる", body.includes("次回付与予定日: 2020-10-01"));

  // 付与する: 次回付与予定日欄には「前回の予定日の1年後」が自動提案される
  // （手動で毎回計算しなくていいように）。日数だけ入力してそのまま付与。
  await admin.getByRole("button", { name: "＋付与する" }).click();
  const suggestedNextDate = await admin.locator('input[type=date]').last().inputValue();
  log("次回付与予定日が自動提案される（前回予定日の1年後）", suggestedNextDate === "2021-10-01");
  await admin.locator('input[type=number]').first().fill("10");
  await admin.getByRole("button", { name: "付与する", exact: true }).click();
  await admin.waitForTimeout(500);

  body = await admin.textContent("body");
  log("付与後、残日数が10日になる", body.includes("残日数: 10日"));
  log("次回付与予定日が自動提案どおり更新される", body.includes("次回付与予定日: 2021-10-01"));

  await admin.getByRole("button", { name: /付与・使用履歴/ }).click();
  body = await admin.textContent("body");
  log("付与履歴に記録される", /付与 \+10日/.test(body));

  // 給与計算画面（今月分）で残日数が見える
  await admin.goto(`http://localhost:3000/company/payroll?month=${thisMonth}&staff=${staffUserId}`);
  body = await admin.textContent("body");
  log("給与計算画面（今月）に残日数10日が表示される", body.includes("残日数: 10日"));
  log("年間付与日数の編集欄は表示されない（廃止済み）", !body.includes("年間付与日数"));

  // 使用日数を3日に変更して保存
  const paidLeaveSection = admin.locator("section", { hasText: "有給休暇" });
  await paidLeaveSection.locator("input[type=number]").first().fill("3");
  await paidLeaveSection.getByRole("button", { name: "保存" }).click();
  await admin.waitForTimeout(500);

  // 翌月分の給与計算画面でも残日数が繰り越されている（7日）ことを確認
  // — 従来は月ごとに独立フィールドでリセットされていたのが直った点
  await admin.goto(`http://localhost:3000/company/payroll?month=${nextMonth}&staff=${staffUserId}`);
  body = await admin.textContent("body");
  log("翌月の給与計算画面でも残日数が繰り越される（7日）", body.includes("残日数: 7日"));

  // スタッフ詳細（契約書管理タブ）でも使用履歴が記録される
  await admin.goto(`http://localhost:3000/company/roster?staff=${staffUserId}`);
  await admin.click("text=契約書管理");
  await admin.waitForTimeout(300);
  body = await admin.textContent("body");
  log("スタッフ詳細でも残日数7日に反映される", body.includes("残日数: 7日"));
  await admin.getByRole("button", { name: /付与・使用履歴/ }).click();
  body = await admin.textContent("body");
  log("使用履歴が記録される", /使用 -3日/.test(body));

  // 入社日を変更しても、既に付与履歴があるスタッフの次回予定日は自動では
  // 書き換わらない（誤って既存スケジュールを壊さないため）
  await admin.locator('input[type=date]').first().fill("2020-05-01");
  await admin.getByRole("button", { name: "保存" }).first().click();
  await admin.waitForTimeout(400);
  body = await admin.textContent("body");
  log("付与済みスタッフの入社日を変更しても次回予定日は変わらない", body.includes("次回付与予定日: 2021-10-01"));

  // ダッシュボードの「有給付与」アラート: 次回付与予定日（2021-10-01）は
  // とっくに過ぎているが、契約満了と違って自動では消えず一覧に残り続ける
  await admin.goto("http://localhost:3000/company");
  body = await admin.textContent("body");
  log("ダッシュボードの有給付与予定件数が1件になる", /有給付与予定[\s\S]{0,20}1\s*件/.test(body));

  await admin.getByText("有給付与予定", { exact: true }).click();
  body = await admin.textContent("body");
  log("有給付与ポップアップに対象スタッフが表示される", body.includes("有給スタッフ") && body.includes("2021-10-01"));

  // 「付与しない」を押すと一覧から消え、次回予定日はクリアされる（自動での
  // 1年後再表示はしない — 見送る時点で退職・契約終了・対象外などの理由が
  // ほとんどで、必要なら管理者が改めて手動で次回予定日を設定し直す）
  await admin.getByRole("button", { name: "付与しない" }).click();
  await admin.waitForTimeout(500);
  body = await admin.textContent("body");
  log("「付与しない」を押すとポップアップから消える", body.includes("付与予定のスタッフはいません"));

  await admin.reload();
  body = await admin.textContent("body");
  log("見送り後はダッシュボードの件数が0件になる", /有給付与予定[\s\S]{0,20}0\s*件/.test(body));

  await admin.goto(`http://localhost:3000/company/roster?staff=${staffUserId}`);
  await admin.click("text=契約書管理");
  await admin.waitForTimeout(300);
  body = await admin.textContent("body");
  log("見送り後は次回予定日がクリアされる（未設定）", body.includes("次回付与予定日: 未設定"));
  await admin.getByRole("button", { name: /付与・使用履歴/ }).click();
  body = await admin.textContent("body");
  log("見送り履歴が記録される", /見送り/.test(body));

  console.log("PAID LEAVE SMOKE TEST PASSED");
} catch (err) {
  console.error("PAID LEAVE SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
