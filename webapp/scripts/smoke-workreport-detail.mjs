import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// スタッフ詳細の稼働履歴・カレンダーの日別詳細から、業務報告の詳細
// （差戻し理由・経緯）を開けるかを検証する。差し戻すと承認待ち一覧から
// 消えるため、それまでは理由を確認する場所が無かった。

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
const companyName = `報告詳細確認株式会社${suffix}`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "報告詳細管理者");
  await page.fill("#email", `rptdetail-admin-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  const adminId = psql(`select id from "User" where email='rptdetail-admin-${suffix}@example.com';`);

  const staffId = psql(
    `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'rptdetail-staff-${suffix}@example.com', 'x', '詳細確認スタッフ', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);

  const day = psql(`select ((now() at time zone 'Asia/Tokyo')::date - 1)::text;`);
  const [y, m, d] = day.split("-").map(Number);
  const shiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'INHOUSE', '通常業務', '${day}', '09:00', '18:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "computedMinutes", "breakMinutes", "clockIn", "clockOut", "submittedAt", comment, "approverUserId", "approvedAt", "rejectionReason", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${shiftId}', '${staffId}', 'WORKED', 'REJECTED', 480, 60, ('${day} 09:00'::timestamp - interval '9 hours'), ('${day} 18:00'::timestamp - interval '9 hours'), now(), '予定通り勤務しました', '${adminId}', now(), '休憩時間が違います。90分で直してください', now(), now());`,
  );

  // --- スタッフ詳細の稼働履歴から開く ---
  await page.goto(`http://localhost:3000/company/roster?staff=${staffId}&y=${y}&m=${m}`);
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: new RegExp(day.slice(5)) }).first().click();
  const dialog = page.getByRole("dialog", { name: "業務報告の詳細" });
  await dialog.waitFor();
  await page.waitForTimeout(500);
  const text = await dialog.innerText();
  log("稼働履歴の行から業務報告の詳細が開く", text.includes("詳細確認スタッフ") && text.includes("通常業務"));
  log("差戻しの理由が出る", text.includes("理由：休憩時間が違います。90分で直してください"));
  log("差戻しした人が出る", text.includes("報告詳細管理者"));
  log("時間・休憩・実働・コメントが出る", text.includes("09:00〜18:00") && text.includes("60分") && text.includes("8時間00分") && text.includes("予定通り勤務しました"));
  await dialog.getByRole("button", { name: "閉じる" }).click();
  await page.waitForTimeout(300);
  log("詳細を閉じてもスタッフ詳細パネルは開いたまま", (await page.locator("body").innerText()).includes("稼働履歴"));

  // --- スタッフが「内容が違う」を押した差戻し ---
  psql(
    `update "WorkReport" set "rejectionReason"='会社の修正内容に同意できないとして差し戻されています。正しい時間に直して再提出してください。', "correctedByUserId"='${adminId}', "correctedAt"=now() where "shiftId"='${shiftId}';`,
  );

  // --- カレンダーの日別詳細から開く ---
  await page.goto(`http://localhost:3000/company/calendar?y=${y}&m=${m}`);
  await page.waitForTimeout(800);
  await page.locator(`button:has(> span:text-is("${d}"))`).first().click();
  await page.waitForTimeout(400);
  const dayModal = page.locator("div.fixed.inset-0.z-20").last();
  await dayModal.getByRole("button", { name: /詳細確認スタッフ/ }).first().click();
  await dialog.waitFor();
  await page.waitForTimeout(500);
  const calText = await dialog.innerText();
  log("カレンダーの日別詳細からも開ける", calText.includes("詳細確認スタッフ"));
  log("「内容が違う」による差戻しはその旨が出る", calText.includes("スタッフが修正内容に同意しませんでした"));
  log("時間を修正した経緯も出る", calText.includes("時間を修正"));

  await dialog.getByRole("button", { name: "閉じる" }).click();
  await page.waitForTimeout(300);

  // --- 承認者の表示（ログインせずに通知メールのリンクから承認したものは承認者が空） ---
  psql(`update "WorkReport" set "approvalStatus"='APPROVED', "approverUserId"='${adminId}', "approvedAt"=now(), "rejectionReason"=null, "correctedAt"=null where "shiftId"='${shiftId}';`);
  await dayModal.getByRole("button", { name: /詳細確認スタッフ/ }).first().click();
  await dialog.waitFor();
  await page.waitForTimeout(500);
  log("承認した人の名前が出る", (await dialog.innerText()).includes("報告詳細管理者"));
  await dialog.getByRole("button", { name: "閉じる" }).click();
  psql(`update "WorkReport" set "approverUserId"=null where "shiftId"='${shiftId}';`);
  await dayModal.getByRole("button", { name: /詳細確認スタッフ/ }).first().click();
  await dialog.waitFor();
  await page.waitForTimeout(500);
  log("承認者が記録されていない承認は「通知メールのリンクから承認」と出る", (await dialog.innerText()).includes("通知メールのリンクから承認"));

  console.log(process.exitCode ? "WORKREPORT DETAIL SMOKE TEST HAD FAILURES" : "WORKREPORT DETAIL SMOKE TEST PASSED");
} finally {
  await browser.close();
}
