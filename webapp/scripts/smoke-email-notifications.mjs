import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`)
    .toString()
    .trim();
}

import { readFileSync } from "node:fs";

// メール送信は"use server"のServer Action内で行われ、console.logの
// [email:fallback]出力はブラウザではなくnext devを動かしているNode
// プロセス側（このリポジトリではdevログファイル）に出る。
// page.on("console")ではブラウザ側のログしか拾えないため、devサーバーの
// ログファイルを直接読む。
const DEV_LOG_PATH = "/tmp/nextdev.log";
function readServerLogSince(startSize) {
  const buf = readFileSync(DEV_LOG_PATH, "utf8");
  return buf.slice(startSize);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminEmail = `emailnotif-admin-${Date.now()}@example.com`;
const staffEmail = `emailnotif-staff-${Date.now()}@example.com`;
const notifEmail = `notify-${Date.now()}@example.com`;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const today = new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10);

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "通知管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  const companyName = `通知テスト株式会社${Date.now()}`;
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  // ①-a 通知メールアドレスを設定できる
  await admin.goto("http://localhost:3000/company/settings");
  await admin.getByRole("button", { name: /変更/ }).first().click();
  await admin.getByPlaceholder("例：shift@your-company.com").fill(notifEmail);
  await admin.getByRole("button", { name: "保存" }).click();
  await admin.waitForTimeout(800);
  let body = await admin.textContent("body");
  log("設定画面に通知メールアドレスが保存・表示される", body.includes(notifEmail));

  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  const savedEmail = psql(`select "notificationEmail" from "Company" where id='${companyId}';`);
  log("DBにも保存されている", savedEmail === notifEmail);

  // staff setup + shift + clock in/out + submit report
  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "通知スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  const assignModal = admin.locator("div.fixed.inset-0.z-20").last();
  await assignModal.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await assignModal.getByRole("button", { name: "＋ 新しい業務内容を追加する" }).click();
  await assignModal.locator('input[placeholder*="業務内容"]').fill("通常業務");
  await assignModal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal.getByRole("button", { name: "通知スタッフ" }).click();
  await assignModal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.getByRole("button", { name: "勤務開始" }).click();
  await staff.waitForTimeout(500);

  const staffUserId = psql(`select id from "User" where email='${staffEmail.toLowerCase()}';`);
  psql(`update "WorkReport" set "clockIn" = now() - interval '8 hours' where "staffUserId"='${staffUserId}';`);
  await staff.reload();
  await staff.waitForTimeout(400);
  await staff.getByRole("button", { name: "勤務終了" }).click();
  await staff.waitForTimeout(500);
  const logSizeBeforeSubmit = readFileSync(DEV_LOG_PATH, "utf8").length;
  await staff.getByRole("button", { name: "業務報告を提出する" }).click();
  await staff.waitForTimeout(800);

  // ① 提出でメール（fallbackログ）が飛び、承認トークンが作られる
  const submitLog = readServerLogSince(logSizeBeforeSubmit);
  const fallbackLog = submitLog.includes("[email:fallback]") && submitLog.includes(notifEmail) && submitLog.includes("業務報告が届きました")
    ? submitLog
    : null;
  log("業務報告提出で通知メール（fallback）が送られる", Boolean(fallbackLog));

  const workReportId = psql(`select id from "WorkReport" where "staffUserId"='${staffUserId}';`);
  const tokenCount = psql(
    `select count(*) from "AccountActionToken" where "workReportId"='${workReportId}' and kind='APPROVE_WORK_REPORT';`,
  );
  log("承認用トークンが1件作られる", tokenCount === "1");

  const tokenHash = psql(
    `select "tokenHash" from "AccountActionToken" where "workReportId"='${workReportId}' and kind='APPROVE_WORK_REPORT';`,
  );
  log("トークンはハッシュ化されて保存される（生トークンがそのままではない）", tokenHash.length === 64);

  // ①-b メール本文中のURLから生トークンを取り出し、ワンクリック承認の
  // 確認画面〜実際の承認までを一通り試す。
  const urlMatch = fallbackLog?.match(/\/email-actions\/approve-work-report\/([A-Za-z0-9_-]+)/);
  log("メール本文に承認リンクが含まれる", Boolean(urlMatch));
  const rawToken = urlMatch?.[1];

  const linkCtx = await browser.newContext();
  const linkPage = await linkCtx.newPage();
  await linkPage.goto(`http://localhost:3000/email-actions/approve-work-report/${rawToken}`);
  let linkBody = await linkPage.textContent("body");
  log("確認画面にスタッフ名・会社名が表示される（ログイン不要）", linkBody.includes("通知スタッフ") && linkBody.includes("通知テスト株式会社"));

  await linkPage.getByRole("button", { name: "承認する" }).click();
  await linkPage.waitForTimeout(500);
  linkBody = await linkPage.textContent("body");
  log("ボタンを押すと承認完了と表示される", linkBody.includes("承認しました"));

  const approvalStatus = psql(`select "approvalStatus" from "WorkReport" where id='${workReportId}';`);
  log("実際にWorkReportがAPPROVEDになる", approvalStatus === "APPROVED");

  // 同じリンクをもう一度開くと「既に処理済み」
  await linkPage.goto(`http://localhost:3000/email-actions/approve-work-report/${rawToken}`);
  linkBody = await linkPage.textContent("body");
  log("同じリンクを再度開くと「既に処理済み」と表示される", linkBody.includes("既に処理済み"));
  await linkCtx.close();

  // ③ 販促品の受注でも通知メールが飛ぶ（画像アップロードはこの環境では
  // 使えないため、既存smoke-promo.mjsと同じくSQLで直接商品を用意する）
  psql(
    `insert into "PromoItem" (id, "companyId", "imageUrl", name, "pointsCost", stock, description, "createdAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', 'https://example.com/item.png', 'テスト景品', 1, 5, 'テスト用', now());`,
  );
  psql(
    `insert into "StaffPointsLedgerEntry" (id, "staffUserId", type, points, "balanceAfter", "createdAt") ` +
      `values (gen_random_uuid()::text, '${staffUserId}', 'ADJUSTMENT', 100, 100, now());`,
  );

  await staff.goto("http://localhost:3000/staff/points");
  await staff.reload();
  await staff.waitForTimeout(300);
  await staff.getByRole("button", { name: /テスト景品/ }).click();
  await staff.waitForTimeout(300);
  await staff.fill('input[placeholder="例：東京都渋谷区〇〇1-2-3"]', "東京都新宿区テスト1-1-1");
  await staff.fill('input[placeholder="例：090-1234-5678"]', "090-0000-1111");
  const logSizeBeforeRedeem = readFileSync(DEV_LOG_PATH, "utf8").length;
  await staff.getByRole("button", { name: "この内容で交換する" }).click();
  await staff.waitForTimeout(700);

  const redeemLog = readServerLogSince(logSizeBeforeRedeem);
  const promoFallback = redeemLog.includes("[email:fallback]") && redeemLog.includes(notifEmail) && redeemLog.includes("販促品の注文が届きました");
  log("販促品の受注で通知メール（fallback）が送られる", promoFallback);

  console.log(process.exitCode ? "EMAIL NOTIFICATIONS SMOKE TEST HAD FAILURES" : "EMAIL NOTIFICATIONS SMOKE TEST PASSED");
} catch (err) {
  console.error("EMAIL NOTIFICATIONS SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
