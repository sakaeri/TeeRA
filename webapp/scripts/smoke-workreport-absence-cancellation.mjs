import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// 「欠勤」「勤務先からのキャンセル」の2つのバグを検証する：
// ①誤タップ防止の確認ダイアログが無かった
// ②会社側のメール・承認確認ページが「時間：未定」等を出すだけで、実際に
//   欠勤/キャンセルだったことを一切伝えていなかった

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`)
    .toString()
    .trim();
}
const DEV_LOG_PATH = "/tmp/nextdev.log";
function readServerLogSince(startSize) {
  return readFileSync(DEV_LOG_PATH, "utf8").slice(startSize);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminEmail = `wrac-admin-${Date.now()}@example.com`;
const staffEmail = `wrac-staff-${Date.now()}@example.com`;
const notifEmail = `wrac-notify-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "欠勤テスト管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  const companyName = `欠勤テスト株式会社${Date.now()}`;
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  await admin.goto("http://localhost:3000/company/settings");
  await admin.getByRole("button", { name: /変更/ }).first().click();
  await admin.getByPlaceholder("例：shift@your-company.com").fill(notifEmail);
  await admin.getByRole("button", { name: "保存" }).click();
  await admin.waitForTimeout(600);
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "欠勤テストスタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail.toLowerCase()}';`);

  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  const assignModal = admin.locator("div.fixed.inset-0.z-20").last();
  await assignModal.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await assignModal.getByRole("button", { name: "＋ 新しい業務内容を追加する" }).click();
  await assignModal.locator('input[placeholder*="業務内容"]').fill("通常業務");
  await assignModal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal.getByRole("button", { name: "欠勤テストスタッフ" }).click();
  await assignModal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  // --- ①確認ダイアログ: キャンセルすると何も起きない ---
  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.getByRole("button", { name: "欠勤", exact: true }).click();
  await staff.waitForTimeout(300);
  let staffBody = await staff.textContent("body");
  log("「欠勤」タップで確認ダイアログが出る", staffBody.includes("欠勤として報告します"));
  await staff.getByRole("button", { name: "キャンセル", exact: true }).click();
  await staff.waitForTimeout(300);
  staffBody = await staff.textContent("body");
  log("確認ダイアログでキャンセルすると何も報告されない（まだ欠勤ボタンが出ている）", staffBody.includes("欠勤"));
  const workReportBeforeConfirm = psql(`select count(*) from "WorkReport" where "staffUserId"='${staffUserId}';`);
  log("キャンセル時点ではWorkReportがまだ作られていない", workReportBeforeConfirm === "0");

  // --- 実際に「欠勤」を確定する ---
  const logStart = readFileSync(DEV_LOG_PATH, "utf8").length;
  await staff.getByRole("button", { name: "欠勤", exact: true }).click();
  await staff.waitForTimeout(300);
  await staff.getByRole("button", { name: "報告する" }).click();
  await staff.waitForTimeout(800);
  staffBody = await staff.textContent("body");
  log("確定後、スタッフ側には「欠勤として報告済みです」と表示される", staffBody.includes("欠勤として報告済みです"));

  const workReportOutcome = psql(`select outcome from "WorkReport" where "staffUserId"='${staffUserId}';`);
  log("WorkReportのoutcomeがABSENTになる", workReportOutcome === "ABSENT");

  // --- ②会社側メール: 欠勤であることがはっきり伝わるか ---
  const emailLog = readServerLogSince(logStart);
  log("通知メールの件名に「欠勤」が入る（従来は「業務報告が届きました」のまま区別つかなかった）", emailLog.includes("欠勤の報告が届きました"));
  log("メール本文に「結果：欠勤」が入る", emailLog.includes("結果") && emailLog.includes("欠勤"));
  log("メール本文に紛らわしい「未定」の時間表示が出ない", !emailLog.includes("時間：未定") && !/時間[^\n]*未定/.test(emailLog));

  const urlMatch = emailLog.match(/\/email-actions\/approve-work-report\/([A-Za-z0-9_-]+)/);
  log("メールに確認リンクが含まれる", Boolean(urlMatch));
  const rawToken = urlMatch?.[1];

  const linkCtx = await browser.newContext();
  const linkPage = await linkCtx.newPage();
  await linkPage.goto(`http://localhost:3000/email-actions/approve-work-report/${rawToken}`);
  let linkBody = await linkPage.textContent("body");
  log("承認確認ページの見出しが「欠勤の確認」になる（従来は「業務報告の承認」のまま紛らわしかった）", linkBody.includes("欠勤の確認"));
  log("承認確認ページに「結果：欠勤」がはっきり表示される", linkBody.includes("結果") && linkBody.includes("欠勤"));
  log("承認確認ページのボタンは「確認する」（「承認する」ではなく）", linkBody.includes("確認する") && !linkBody.includes("承認する"));

  await linkPage.getByRole("button", { name: "確認する" }).click();
  await linkPage.waitForTimeout(500);
  linkBody = await linkPage.textContent("body");
  log("ボタンを押すと「確認しました」と表示される", linkBody.includes("確認しました"));
  await linkCtx.close();

  // --- 勤務先からのキャンセルも同様に検証（2件目のシフト） ---
  // UIから同日に2件目を作ると重複警告モーダルを挟むため、ここでは検証の
  // 本題（キャンセル報告のメール表示）に集中するべくSQLで直接用意する
  // （タイムカードは今日以前のシフトしか一覧に出さないため、日付は今日）。
  psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, date, "startTime", "endTime", "taskName", status, "createdVia", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'INHOUSE', (now() at time zone 'Asia/Tokyo')::date, '09:00', '18:00', '通常業務2', 'CONFIRMED', 'ASSIGN', now());`,
  );

  const logStart2 = readFileSync(DEV_LOG_PATH, "utf8").length;
  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.getByRole("button", { name: "勤務先からのキャンセル" }).click();
  await staff.waitForTimeout(300);
  staffBody = await staff.textContent("body");
  log("「勤務先からのキャンセル」タップでも確認ダイアログが出る", staffBody.includes("勤務先からのキャンセルとして報告します"));
  await staff.getByRole("button", { name: "報告する" }).click();
  await staff.waitForTimeout(800);

  const emailLog2 = readServerLogSince(logStart2);
  log("勤務先からのキャンセルでも件名に反映される", emailLog2.includes("勤務先からのキャンセルの報告が届きました"));

  console.log(process.exitCode ? "WORKREPORT ABSENCE/CANCELLATION SMOKE TEST HAD FAILURES" : "WORKREPORT ABSENCE/CANCELLATION SMOKE TEST PASSED");
} catch (err) {
  console.error("WORKREPORT ABSENCE/CANCELLATION SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
