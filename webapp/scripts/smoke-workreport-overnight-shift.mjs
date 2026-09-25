import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

// 深夜またぎシフト（出勤が23:59 JST、退勤が翌日の実行時刻）の業務報告が
// 正しく提出できることを確認する。修正前は、提出前プレビューの妥当性
// チェックがHH:MMの数値だけを比較して日付をまたぐケースを考慮していな
// かったため、「退勤が出勤より前」と誤判定されて提出ボタンが永久に押せ
// なくなっていた（StaffTimecardView.tsxのhasInvalidTimeRange）。

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

const adminEmail = `wr-overnight-admin-${Date.now()}@example.com`;
const staffEmail = `wr-overnight-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "深夜シフト管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "深夜シフトテスト株式会社");
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
  await staff.fill("#name", "深夜シフトスタッフ");
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
  await assignModal.locator('input[placeholder*="業務内容"]').fill("夜勤");
  await assignModal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal.getByRole("button", { name: "深夜シフトスタッフ" }).click();
  await assignModal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.getByRole("button", { name: "勤務開始" }).click();
  await staff.waitForTimeout(600);

  // 出勤時刻を「前日23:59 JST」に書き換える — 実行時刻(=退勤時刻)がいつで
  // あっても、HH:MMだけを見れば必ず「退勤 < 出勤」に見える（真夜中をまた
  // ぐ）状況を作る。
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);
  psql(
    `update "WorkReport" set "clockIn" = (((now() at time zone 'Asia/Tokyo')::date - interval '1 day' + interval '23 hours 59 minutes') at time zone 'Asia/Tokyo') where "staffUserId"='${staffUserId}';`,
  );
  await staff.reload();
  await staff.waitForTimeout(400);
  let staffBody = await staff.textContent("body");
  log("出勤時刻が23:59と表示される", staffBody.includes("23:59"));

  await staff.getByRole("button", { name: "勤務終了" }).click();
  await staff.waitForTimeout(600);
  staffBody = await staff.textContent("body");
  log("退勤後、提出ボタンが表示される", staffBody.includes("業務報告を提出する"));
  log(
    "「退勤時刻が出勤時刻より前」の警告は出ない（深夜またぎは無効な範囲ではない）",
    !staffBody.includes("退勤時刻が出勤時刻より前になっています"),
  );

  const submitButton = staff.getByRole("button", { name: "業務報告を提出する" });
  log("提出ボタンが無効化されていない（クリックできる）", await submitButton.isEnabled());

  await submitButton.click();
  await staff.waitForTimeout(800);
  staffBody = await staff.textContent("body");
  log("深夜またぎシフトの業務報告が提出できる（承認待ちになる）", staffBody.includes("承認待ち"));

  const computedMinutes = psql(
    `select "computedMinutes" from "WorkReport" where "staffUserId"='${staffUserId}';`,
  );
  log(
    "実働時間が正しく（0分やマイナスではなく）計算されている",
    Number(computedMinutes) > 0 && Number(computedMinutes) < 24 * 60,
  );

  console.log(
    process.exitCode ? "WORKREPORT OVERNIGHT SHIFT SMOKE TEST HAD FAILURES" : "WORKREPORT OVERNIGHT SHIFT SMOKE TEST PASSED",
  );
} catch (err) {
  console.error("WORKREPORT OVERNIGHT SHIFT SMOKE TEST FAILED", err);
  await staff.screenshot({ path: "/tmp/smoke-workreport-overnight-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
