import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(
    `PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`,
  )
    .toString()
    .split("\n")
    .filter((line) => !/^(INSERT|UPDATE|DELETE)\s/.test(line))
    .join("\n")
    .trim();
}

const DEV_LOG_PATH = "/tmp/nextdev.log";
function readServerLogSince(startSize) {
  return readFileSync(DEV_LOG_PATH, "utf8").slice(startSize);
}
const CRON_SECRET = "local-dev-cron-secret-not-for-production";
async function callCron(job) {
  return fetch(`http://localhost:3000/api/cron/notifications?job=${job}`, {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
}

// 検証対象:
// - 業務報告の提出通知: チームに通知先メアドがあればそちらへ届き、本部の
//   notificationEmailには届かない。チームに通知先メアドが無ければ本部へ
//   フォールバックする。
// - シフト希望ダイジェスト: 本部へは会社全体の集計のみ届き、各チームへは
//   そのチームの通知先メアドが設定されていれば個別の件数が届く。

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();
const staffA = await (await browser.newContext()).newPage();
const staffB = await (await browser.newContext()).newPage();

const suffix = Date.now();
const adminEmail = `teamnotif-admin-${suffix}@example.com`;
const companyName = `チーム通知確認株式会社${suffix}`;
const companyNotifyEmail = `company-notify-${suffix}@example.com`;
const teamANotifyEmail = `team-a-notify-${suffix}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "チーム通知確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}' order by "createdAt" desc limit 1;`);
  psql(
    `update "Company" set "teeBalance" = 10 where id = '${companyId}';` +
      `insert into "TeeLedgerEntry" (id, "companyId", type, amount, "balanceAfter", "createdAt") values (gen_random_uuid()::text, '${companyId}', 'ADJUSTMENT', 10, 10, now());`,
  );

  // 会社の通知先メアドを設定
  await admin.goto("http://localhost:3000/company/settings");
  await admin.getByRole("button", { name: /変更/ }).first().click();
  await admin.getByPlaceholder("例：shift@your-company.com").fill(companyNotifyEmail);
  await admin.getByRole("button", { name: "保存" }).click();
  await admin.waitForTimeout(1000);

  // チームA（通知先メアドを設定）・チームB（未設定のまま＝本部へフォールバック確認用）を作成
  await admin.goto("http://localhost:3000/company/settings?tab=basic");
  for (const name of ["チームA", "チームB"]) {
    await admin.getByRole("button", { name: "＋チームを作成" }).click();
    await admin.waitForTimeout(300);
    const modal = admin.locator("div.fixed.inset-0.z-30").last();
    await modal.getByPlaceholder("新しいチーム名").fill(name);
    await modal.getByRole("button", { name: "作成", exact: true }).click();
    await admin.waitForTimeout(600);
  }
  const teamAId = psql(`select id from "Team" where "companyId"='${companyId}' and name='チームA';`);
  const teamBId = psql(`select id from "Team" where "companyId"='${companyId}' and name='チームB';`);

  // 作成順（listTeamsはcreatedAt昇順）でチームAが0番目に並ぶ。hasTextで
  // 都度絞り込むと、編集モードに入った瞬間に表示テキストが変わって
  // 再マッチしなくなるため、インデックスで固定する。
  const teamACard = admin.locator("div.rounded-xl.border.border-border.p-4").nth(0);
  await teamACard.getByRole("button", { name: "チーム名・通知先を変更" }).click();
  await admin.waitForTimeout(200);
  await teamACard.locator('input[type="email"]').fill(teamANotifyEmail);
  await teamACard.getByRole("button", { name: "保存", exact: true }).click();
  await admin.waitForTimeout(1200);
  const savedTeamAEmail = psql(`select "notificationEmail" from "Team" where id='${teamAId}';`);
  log("セットアップ: チームAに通知先メアドを設定できた", savedTeamAEmail === teamANotifyEmail);

  // スタッフ2名を招待し、それぞれチームA/チームBのシフトに割り当てる
  async function inviteStaff(page, name, email) {
    await admin.goto("http://localhost:3000/company/roster");
    await admin.click("text=＋スタッフを追加");
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
  }
  await inviteStaff(staffA, "チームAスタッフ", `teamnotif-staffa-${suffix}@example.com`);
  await inviteStaff(staffB, "チームBスタッフ", `teamnotif-staffb-${suffix}@example.com`);
  const staffAUserId = psql(`select id from "User" where name='チームAスタッフ' order by "createdAt" desc limit 1;`);
  const staffBUserId = psql(`select id from "User" where name='チームBスタッフ' order by "createdAt" desc limit 1;`);

  async function createShiftFor(staffName) {
    await admin.goto("http://localhost:3000/company/calendar");
    await admin.locator("button", { hasText: "＋" }).last().click();
    await admin.getByText("シフトを作成").click();
    const modal = admin.locator("div.fixed.inset-0.z-20").last();
    // 複数チームがある場合は先に「どのチームのシフトを作成しますか？」が
    // 出る（どのチームを選んでも、このあとteamIdをSQLで上書きするため
    // 結果に影響しない）。
    if (await modal.getByText("どのチームのシフトを作成しますか？").count()) {
      await modal.getByRole("button", { name: /チーム/ }).first().click();
      await admin.waitForTimeout(200);
    }
    await modal.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
    await modal.getByRole("button", { name: "＋ 新しい業務内容を追加する" }).click();
    await modal.locator('input[placeholder*="業務内容"]').fill("通常業務");
    await modal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
    await admin.waitForTimeout(300);
    await modal.getByRole("button", { name: staffName }).click();
    await admin.waitForTimeout(200);
    await modal.getByRole("button", { name: "次へ" }).click();
    await admin.waitForTimeout(300);
    await modal.getByRole("button", { name: /件のシフトを作成/ }).click();
    await admin.waitForTimeout(800);
  }
  await createShiftFor("チームAスタッフ");
  await createShiftFor("チームBスタッフ");
  // シフト作成UIのチーム選択ステップでは常に先頭（チームA）を選んでいるため、
  // 作成済みシフトへ無条件にteamIdを上書きする（smoke-team-scoped-
  // permissions.mjsの手法と同じだが、"teamId is null"条件は付けない —
  // 複数チームがある会社では作成時点で既にteamIdが入っているため）。
  psql(`update "Shift" set "teamId"='${teamAId}' where "staffUserId"='${staffAUserId}';`);
  psql(`update "Shift" set "teamId"='${teamBId}' where "staffUserId"='${staffBUserId}';`);

  // --- チームA（通知先メアドあり）のスタッフが業務報告を提出 → チームAのメアドに届き、本部へは届かない ---
  async function submitReport(page, staffUserId) {
    await page.goto("http://localhost:3000/staff/timecard");
    await page.getByRole("button", { name: "勤務開始" }).click();
    await page.waitForTimeout(400);
    psql(`update "WorkReport" set "clockIn" = now() - interval '8 hours' where "staffUserId"='${staffUserId}';`);
    await page.reload();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "勤務終了" }).click();
    await page.waitForTimeout(400);
    const logStart = readFileSync(DEV_LOG_PATH, "utf8").length;
    await page.getByRole("button", { name: "業務報告を提出する" }).click();
    await page.waitForTimeout(800);
    return readServerLogSince(logStart);
  }

  const logA = await submitReport(staffA, staffAUserId);
  log("チームA（通知先あり）の提出はチームAのメアドに届く", logA.includes(teamANotifyEmail) && logA.includes("業務報告が届きました"));
  log("チームA（通知先あり）の提出は本部のメアドには届かない", !logA.includes(companyNotifyEmail));

  const logB = await submitReport(staffB, staffBUserId);
  log("チームB（通知先未設定）の提出は本部のメアドにフォールバックする", logB.includes(companyNotifyEmail) && logB.includes("業務報告が届きました"));
  log("チームB（通知先未設定）の提出はチームAのメアドには届かない", !logB.includes(teamANotifyEmail));

  // --- シフト希望ダイジェスト: 本部は全体集計、チームAは個別件数 ---
  psql(
    `insert into "ShiftRequest" (id, "staffUserId", "companyId", "teamId", desire, dates, status) ` +
      `values (gen_random_uuid()::text, '${staffAUserId}', '${companyId}', '${teamAId}', 'WORK', ARRAY[current_date + 3]::date[], 'PENDING');`,
  );
  psql(
    `insert into "ShiftRequest" (id, "staffUserId", "companyId", "teamId", desire, dates, status) ` +
      `values (gen_random_uuid()::text, '${staffBUserId}', '${companyId}', '${teamBId}', 'WORK', ARRAY[current_date + 3]::date[], 'PENDING');`,
  );

  const digestLogStart = readFileSync(DEV_LOG_PATH, "utf8").length;
  const digestRes = await callCron("shift-request-digest");
  await new Promise((r) => setTimeout(r, 600));
  log("shift-request-digestは200", digestRes.status === 200);
  const digestLog = readServerLogSince(digestLogStart);
  log(
    "本部には会社全体の集計（2件）が届く",
    digestLog.includes(companyNotifyEmail) && digestLog.includes("未確定のシフト希望") && digestLog.includes("2件"),
  );
  log(
    "チームA（通知先あり）には個別の件数（1件）が届く",
    digestLog.includes(teamANotifyEmail) && digestLog.includes("1件"),
  );

  console.log(process.exitCode ? "TEAM-SCOPED NOTIFICATIONS SMOKE TEST HAD FAILURES" : "TEAM-SCOPED NOTIFICATIONS SMOKE TEST PASSED");
} catch (err) {
  console.error("TEAM-SCOPED NOTIFICATIONS SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
