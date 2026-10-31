import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 「未確定のシフト希望があります」の通知から開いたとき：
// ・メールのボタン（プッシュも同じ）の行き先が /company?open=unconfirmed
// ・そこを開くと、ダッシュボードの「未確定シフト」の一覧が開いた状態になる
// ・開いた後はURLの指定が消え、再読み込みしても勝手に開かない

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
const DEV_LOG_PATH = "/tmp/nextdev.log";
const CRON_SECRET = "local-dev-cron-secret-not-for-production";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const suffix = Date.now();
const email = `unconfirmed-link-${suffix}@example.com`;
const notifyEmail = `unconfirmed-notify-${suffix}@example.com`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "未確定リンク確認");
  await page.fill("#email", email);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", `未確定リンク株式会社${suffix}`);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='未確定リンク株式会社${suffix}';`);
  const userId = psql(`select id from "User" where email='${email}';`);
  psql(`update "Company" set "notificationEmail"='${notifyEmail}' where id='${companyId}';`);
  psql(
    `insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, note, status) ` +
      `values (gen_random_uuid()::text, '${userId}', '${companyId}', 'WORK', ARRAY[current_date + 5]::date[], 'リンク確認メモ', 'PENDING');`,
  );

  const logStart = readFileSync(DEV_LOG_PATH, "utf8").length;
  await fetch("http://localhost:3000/api/cron/notifications?job=shift-request-digest", {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  await new Promise((r) => setTimeout(r, 600));
  const digestLog = readFileSync(DEV_LOG_PATH, "utf8").slice(logStart);
  const mailPart = digestLog.slice(digestLog.indexOf(notifyEmail));
  log("通知メールのボタンの行き先が /company?open=unconfirmed", digestLog.includes(notifyEmail) && mailPart.includes("/company?open=unconfirmed"));

  await page.goto("http://localhost:3000/company?open=unconfirmed");
  const popup = page.locator("div.fixed.inset-0", { hasText: "スタッフから提出された希望シフトです" }).last();
  await popup.waitFor();
  log("開くと「未確定シフト」の一覧が開いている", await popup.getByText("リンク確認メモ").isVisible());
  await page.waitForTimeout(300);
  log("開いた後はURLから指定が消える", !page.url().includes("open="));
  await page.reload();
  await page.getByRole("region", { name: "よく使う操作" }).waitFor();
  await page.waitForTimeout(300);
  log("再読み込みしても勝手に開かない", (await page.getByText("スタッフから提出された希望シフトです").count()) === 0);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(process.exitCode ? "UNCONFIRMED DEEPLINK SMOKE TEST FAILED" : "UNCONFIRMED DEEPLINK SMOKE TEST PASSED");
