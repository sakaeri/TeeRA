import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 業務報告の内容がカレンダー・スタッフ名簿に反映されるかを検証する：
// ・出勤報告 → 月表示「名前✓」、日別詳細は報告した実績時間
// ・欠勤報告 → 月表示「（欠勤）」、時間欄は「欠勤」（残った打刻時刻は出さない）
// ・打刻しただけ（未提出） → 「未承認」ではなく「未提出」
// ・依頼主取消で休み → 月表示「（取消）」、日別詳細に理由つきで残る
// ・スタッフの「勤務先からのキャンセル」を承認 → 規定のキャンセル料を記録

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
const page = await (await browser.newContext()).newPage();
const suffix = Date.now();
const companyName = `報告反映確認株式会社${suffix}`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "報告反映管理者");
  await page.fill("#email", `rptstatus-admin-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  const addStaff = (name) => {
    const id = psql(
      `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'rptstatus-${name}-${suffix}@example.com', 'x', '${name}', now()) returning id) select id from ins;`,
    );
    psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${id}', '${companyId}', 'STAFF');`);
    return id;
  };
  const workedId = addStaff("出勤スタッフ");
  const absentId = addStaff("欠勤スタッフ");
  const clockedId = addStaff("打刻のみスタッフ");
  const leftOffId = addStaff("取消休みスタッフ");
  const siteCancelId = addStaff("当日取消スタッフ");

  // 依頼主（代理の取引先＝自社で承認）と、キャンセル料3000円の規定
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") values (gen_random_uuid()::text, '${companyId}', '${companyId}', '反映確認ゴルフ場', 'ACTIVE', now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "CompanyPlacementRate" (id, "companyId", "companyRelationshipId", "taskName", "cancelPolicy", "cancelDeadlineDaysBefore", "cancelDeadlineTime", "cancelFeeAmount") values (gen_random_uuid()::text, '${companyId}', '${relId}', 'キャディ', 'FEE_AFTER_DEADLINE', 1, '17:00', 3000);`,
  );

  const day = psql(`select ((now() at time zone 'Asia/Tokyo')::date - 1)::text;`);
  const [y, m, d] = day.split("-").map(Number);
  const shift = (staffId, extra = "") =>
    psql(
      `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
        `values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'CLIENT', '${relId}', 'キャディ', '${day}', null, null, false, true, ${extra || "'CONFIRMED'"}, 'ASSIGN', now(), now()) returning id) select id from ins;`,
    );
  const report = (shiftId, staffId, cols) =>
    psql(
      `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "computedMinutes", "breakMinutes", "clockIn", "clockOut", "submittedAt", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${shiftId}', '${staffId}', ${cols}, now(), now());`,
    );
  const at = (hm) => `('${day} ${hm}'::timestamp - interval '9 hours')`;

  const workedShift = shift(workedId);
  report(workedShift, workedId, `'WORKED', 'PENDING', 440, 0, ${at("08:33")}, ${at("15:53")}, now()`);
  const absentShift = shift(absentId);
  report(absentShift, absentId, `'ABSENT', 'APPROVED', 0, 0, ${at("09:40")}, null, now()`);
  const clockedShift = shift(clockedId);
  report(clockedShift, clockedId, `'WORKED', 'PENDING', 0, 0, ${at("08:00")}, ${at("12:00")}, null`);
  const leftOffShift = shift(leftOffId, "'CANCELLED'");
  psql(`insert into "ShiftCancellation" (id, "shiftId", "cancelledByCompanyId", source, "feeAmount") values (gen_random_uuid()::text, '${leftOffShift}', '${companyId}', 'CLIENT_APP', 5000);`);
  const siteCancelShift = shift(siteCancelId);
  report(siteCancelShift, siteCancelId, `'CANCELLED_BY_EMPLOYER', 'PENDING', 0, 0, null, null, now()`);

  // --- 月表示のタグ ---
  await page.goto(`http://localhost:3000/company/calendar?y=${y}&m=${m}`);
  await page.waitForTimeout(800);
  const cell = page.locator(`button:has(> span:text-is("${d}"))`).first();
  const cellText = await cell.innerText();
  log("出勤報告は「名前✓」", cellText.includes("出勤スタッフ✓"));
  log("欠勤報告は「（欠勤）」", cellText.includes("欠勤スタッフ（欠勤）"));
  log("当日の勤務先キャンセル報告は「（取消）」", cellText.includes("当日取消スタッフ（取消）"));
  log("依頼主取消で休みになったものも「（取消）」で残る", cellText.includes("取消休みスタッフ（取消）"));
  const clockedTagClass = await cell.locator("span", { hasText: /^打刻のみスタッフ$/ }).getAttribute("class");
  log("過去日で報告漏れのものは赤枠", (clockedTagClass ?? "").includes("ring-red-400"));

  // --- 日別詳細 ---
  await cell.click();
  await page.waitForTimeout(400);
  const modal = page.locator("div.fixed.inset-0.z-20").last();
  const rowText = async (name) => (await modal.locator("li", { hasText: name }).first().innerText()).replace(/\s+/g, " ");
  const workedRow = await rowText("出勤スタッフ");
  log("出勤報告は報告した実績時間を出す（予定の「未定」は出さない）", workedRow.includes("08:33〜15:53") && !workedRow.includes("未定"));
  const absentRow = await rowText("欠勤スタッフ");
  log("欠勤報告は時間欄が「欠勤」で、残った打刻は出さない", absentRow.includes("欠勤") && !absentRow.includes("09:40"));
  log("打刻のみは「未提出」", (await rowText("打刻のみスタッフ")).includes("未提出"));
  const leftOffRow = await rowText("取消休みスタッフ");
  log("依頼主取消で休みは理由・キャンセル料つきで残る", leftOffRow.includes("依頼主取消（アプリ）・キャンセル料 5,000円（休み）"));

  // --- スタッフ名簿の稼働履歴 ---
  await page.goto(`http://localhost:3000/company/roster?staff=${clockedId}`);
  await page.waitForTimeout(800);
  const clockedPanel = await page.locator("li", { hasText: day.slice(5) }).first().innerText();
  log("名簿：打刻だけのものは「未承認」でなく「未提出」", clockedPanel.includes("未提出") && !clockedPanel.includes("未承認"));
  await page.goto(`http://localhost:3000/company/roster?staff=${absentId}`);
  await page.waitForTimeout(800);
  const absentPanel = await page.locator("li", { hasText: day.slice(5) }).first().innerText();
  log("名簿：欠勤は打刻時刻でなく「欠勤」と出る", absentPanel.includes("欠勤") && !absentPanel.includes("09:40"));

  // --- 勤務先からのキャンセルを承認するとキャンセル料が記録される ---
  await page.goto("http://localhost:3000/company/settings?tab=workreports");
  await page.waitForTimeout(800);
  await page.locator("li", { hasText: "当日取消スタッフ" }).getByRole("button", { name: "承認する" }).click();
  await page.waitForTimeout(800);
  log(
    "承認すると規定のキャンセル料(3000円)が記録される",
    psql(`select source || '|' || "feeAmount" from "ShiftCancellation" where "shiftId"='${siteCancelShift}';`) === "STAFF_REPORTED|3000",
  );
  await page.goto(`http://localhost:3000/company/calendar?y=${y}&m=${m}`);
  await page.waitForTimeout(800);
  await page.locator(`button:has(> span:text-is("${d}"))`).first().click();
  await page.waitForTimeout(400);
  log("日別詳細にキャンセル料が出る", (await rowText("当日取消スタッフ")).includes("キャンセル料 3,000円"));

  console.log(process.exitCode ? "CALENDAR REPORT STATUS SMOKE TEST HAD FAILURES" : "CALENDAR REPORT STATUS SMOKE TEST PASSED");
} finally {
  await browser.close();
}
