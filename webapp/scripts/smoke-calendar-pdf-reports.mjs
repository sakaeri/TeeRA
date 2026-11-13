import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// シフト表PDFの「時間」欄：
// ・出勤の報告があるものは報告の実際の時間
// ・欠勤・取消の報告は「欠勤」「取消」
// ・日付が過ぎたのに報告がまだのものは「（未報告）」付き（未定なら「未報告」）
// ・今日以降で報告がまだのものは予定の時間のまま

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`)
    .toString()
    .trim()
    .split("\n")[0];
}
async function pdfText(buffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(" ") + "\n";
  }
  return text;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext()).newPage();
const suffix = Date.now();
const companyName = `PDF報告確認${suffix}`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "PDF本部");
  await page.fill("#email", `pdfrep-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  const staff = (name) =>
    psql(
      `insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'pdfrep-${name}-${suffix}@example.com', 'x', '${name}', now()) returning id;`,
    );
  // 先月の10日・11日（過去）と、来月の10日（未来）
  const lastMonth = psql(`select to_char((now() at time zone 'Asia/Tokyo')::date - interval '1 month', 'YYYY-MM');`);
  const nextMonth = psql(`select to_char((now() at time zone 'Asia/Tokyo')::date + interval '1 month', 'YYYY-MM');`);
  const shift = (userId, date, undecided) =>
    psql(
      `insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
        `values (gen_random_uuid()::text, '${companyId}', '${userId}', 'INHOUSE', '確認', '${date}', ${undecided ? "null, null" : "'09:00', '17:00'"}, false, ${undecided}, 'CONFIRMED', 'ASSIGN', now(), now()) returning id;`,
    );
  const report = (shiftId, userId, outcome, clock) =>
    psql(
      `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "computedMinutes", "breakMinutes", "clockIn", "clockOut", "submittedAt", "createdAt", "updatedAt") ` +
        `values (gen_random_uuid()::text, '${shiftId}', '${userId}', '${outcome}', 'APPROVED', 400, 60, ${clock ? `'${clock[0]}', '${clock[1]}'` : "null, null"}, now(), now(), now());`,
    );

  const worked = staff("出勤太郎");
  const workedShift = shift(worked, `${lastMonth}-10`, true);
  // 08:05〜15:20（日本時間）
  report(workedShift, worked, "WORKED", [`${lastMonth}-09 23:05:00+00`, `${lastMonth}-10 06:20:00+00`]);
  const absent = staff("欠勤花子");
  report(shift(absent, `${lastMonth}-10`, false), absent, "ABSENT", null);
  const cancelled = staff("取消次郎");
  report(shift(cancelled, `${lastMonth}-10`, false), cancelled, "CANCELLED_BY_EMPLOYER", null);
  const missingTimed = staff("未報告三郎");
  shift(missingTimed, `${lastMonth}-11`, false);
  const missingUndecided = staff("未報告未定子");
  shift(missingUndecided, `${lastMonth}-11`, true);
  const future = staff("来月四郎");
  shift(future, `${nextMonth}-10`, false);

  const [ly, lm] = lastMonth.split("-").map(Number);
  const pastRes = await page.request.get(`http://localhost:3000/api/calendar/pdf?y=${ly}&m=${lm}`);
  const past = (await pdfText(await pastRes.body())).replace(/\s+/g, " ");
  const after = (name) => past.slice(past.indexOf(name), past.indexOf(name) + 40);
  log("出勤の報告は報告の実際の時間（08:05〜15:20）", after("出勤太郎").includes("08:05〜15:20"));
  log("欠勤の報告は「欠勤」", after("欠勤花子").includes("欠勤"));
  log("取消の報告は「取消」", after("取消次郎").includes("取消"));
  log("過去で報告がまだなら「（未報告）」付き", after("未報告三郎").includes("09:00〜17:00（未報告）"));
  log("過去で時間未定のまま報告がまだなら「未報告」", after("未報告未定子").includes("未報告") && !after("未報告未定子").includes("未定 "));
  log("シフト表の上に合計（件数・人数）が出る", /合計 ?5件・5人/.test(past));

  // 実績表（請求の内容）：承認済みの出勤とキャンセル料のある取消だけ
  const cancelFee = staff("料金五郎");
  const feeShift = shift(cancelFee, `${lastMonth}-12`, false);
  psql(`update "Shift" set status='CANCELLED' where id='${feeShift}';`);
  psql(`insert into "ShiftCancellation" (id, "shiftId", "cancelledByCompanyId", source, "feeAmount") values (gen_random_uuid()::text, '${feeShift}', '${companyId}', 'CLIENT_APP', 3000);`);
  const actualRes = await page.request.get(`http://localhost:3000/api/calendar/pdf?y=${ly}&m=${lm}&kind=actual`);
  const actual = (await pdfText(await actualRes.body())).replace(/\s+/g, " ");
  log("実績表のタイトルは「実績表」", actual.includes("実績表"));
  log("実績表に承認済みの出勤が実際の時間で載る", actual.includes("出勤太郎") && actual.includes("08:05〜15:20"));
  log("実績表にキャンセル料のある取消が載る", actual.includes("料金五郎") && actual.includes("取消（キャンセル料あり）"));
  log(
    "実績表に欠勤・料金なしの取消・未報告は載らない",
    !actual.includes("欠勤花子") && !actual.includes("取消次郎") && !actual.includes("未報告三郎") && !actual.includes("未報告未定子"),
  );
  log("実績表に「承認済みの業務報告…のみ」の注記", actual.includes("承認済みの業務報告"));
  log(
    "実績表の上に合計（件数・人数・出勤・実働・キャンセル料ありの取消）が出る",
    /合計 ?2件・2人（出勤 ?1件・実働 ?6時間40分／取消（キャンセル料あり）1件）/.test(actual),
  );

  const [ny, nm] = nextMonth.split("-").map(Number);
  const futureRes = await page.request.get(`http://localhost:3000/api/calendar/pdf?y=${ny}&m=${nm}`);
  const futureText = (await pdfText(await futureRes.body())).replace(/\s+/g, " ");
  const f = futureText.slice(futureText.indexOf("来月四郎"), futureText.indexOf("来月四郎") + 40);
  log("今日以降で報告がまだなら予定の時間のまま", f.includes("09:00〜17:00") && !f.includes("未報告"));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(process.exitCode ? "CALENDAR PDF REPORTS SMOKE TEST FAILED" : "CALENDAR PDF REPORTS SMOKE TEST PASSED");
