import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 公開募集はやめたが、やめる前に公開した募集が残っている会社のために、日付が過ぎても
// 埋まらなかった枠のTee（ロック分）はカレンダーを開いたときに今まで通り自動で返金される。

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`)
    .toString()
    .split("\n")
    .filter((line) => !/^(INSERT|UPDATE|DELETE)\s/.test(line))
    .join("\n")
    .trim();
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();
const suffix = Date.now();
const companyName = `Tee返金確認${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "返金本部");
  await admin.fill("#email", `teerefund-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  // 以前に公開した募集（昨日・2枠×10Teeをロック済み・誰も入らなかった）
  psql(`update "Company" set "teeBalance"=80 where id='${companyId}';`);
  const recId = `teerefund-${suffix}`;
  psql(
    `insert into "PublicRecruitment" (id, "companyId", title, date, "maxEntries", "lockedTee", status, visibility, "hourlyWage", "wageType", "isUndecided", "extraItems", "publishedAt", "publicOpenedAt", "createdAt", "updatedAt") ` +
      `values ('${recId}', '${companyId}', '以前の公開募集', current_date - 1, 2, 20, 'PUBLISHED', 'PUBLIC', 1200, 'HOURLY', true, '[]'::jsonb, now(), now(), now(), now());`,
  );

  await admin.goto("http://localhost:3000/company/calendar");
  await admin.waitForTimeout(1200);
  log("日付が過ぎて埋まらなかった枠のTeeは返金される（ロック0）", psql(`select "lockedTee" from "PublicRecruitment" where id='${recId}';`) === "0");
  log("残高が戻る（80→100）", psql(`select "teeBalance" from "Company" where id='${companyId}';`) === "100");

  console.log(process.exitCode ? "RECRUITMENT TEE REFUND SMOKE TEST HAD FAILURES" : "RECRUITMENT TEE REFUND SMOKE TEST PASSED");
} catch (err) {
  console.error("RECRUITMENT TEE REFUND SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
