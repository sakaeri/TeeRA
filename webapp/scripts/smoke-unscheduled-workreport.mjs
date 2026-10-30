import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// シフト外の勤務（シフトが無いまま働いた日）をスタッフが報告できること、
// 本部の承認待ちに「シフト外」として並び、通常の報告と同じく承認できること、
// 既にシフトがある時間帯には出せないことを確認する。

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
const admin = await (await browser.newContext()).newPage();
const staff = await (await browser.newContext()).newPage();
const stamp = Date.now();
const adminEmail = `unsched-admin-${stamp}@example.com`;
const staffEmail = `unsched-staff-${stamp}@example.com`;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const yesterday = new Date(Date.now() + JST_OFFSET_MS - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "シフト外管理者");
  await admin.fill("#email", adminEmail);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "シフト外テスト株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='シフト外テスト株式会社' order by "createdAt" desc limit 1;`);

  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "シフト外スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(/\/invite\//);
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // 配属済みの依頼主（仮アカウント）を1つ用意し、勤務先として選べることを確認する
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") values (gen_random_uuid()::text, '${companyId}', '${companyId}', 'テスト現場', 'ACTIVE', now()) returning id) select id from ins;`,
  );
  psql(`insert into "StaffPlacement" (id, "staffUserId", "companyRelationshipId", active, "createdAt") values (gen_random_uuid()::text, '${staffUserId}', '${relId}', true, now());`);

  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.getByRole("button", { name: "＋シフト外の勤務を報告する" }).click();
  const modal = staff.locator("div.fixed.inset-0.z-40").last();
  const workplaceOptions = await modal.locator("label", { hasText: "勤務先" }).locator("option").allTextContents();
  log("勤務先に自社と配属済みの依頼主が出る", workplaceOptions.some((o) => o.startsWith("自社")) && workplaceOptions.includes("テスト現場"));

  await modal.locator("label", { hasText: "勤務先" }).locator("select").selectOption(relId);
  await modal.locator("label", { hasText: "勤務日" }).locator("input").fill(yesterday);
  await modal.locator("label", { hasText: "業務内容" }).locator("input").fill("緊急対応");
  await modal.locator("label", { hasText: "出勤" }).first().locator("input").fill("09:00");
  await modal.locator("label", { hasText: "退勤" }).locator("input").fill("17:00");
  await modal.locator("label", { hasText: "休憩" }).locator("input").fill("60");
  await modal.getByRole("button", { name: "業務報告を提出する" }).click();
  await staff.waitForTimeout(1000);
  log("提出後に完了メッセージが出る", (await staff.textContent("body")).includes("シフト外の勤務を報告しました"));

  const row = psql(
    `select s."createdVia", s.source, s."companyRelationshipId", w."approvalStatus", w."computedMinutes", (w."submittedAt" is not null) from "Shift" s join "WorkReport" w on w."shiftId"=s.id where s."staffUserId"='${staffUserId}';`,
  );
  log(
    "シフト(STAFF_REPORT・依頼主の現場)と提出済みの業務報告(実働420分)が作られる",
    row === `STAFF_REPORT|CLIENT|${relId}|PENDING|420|t`,
  );

  // 本部の承認待ちに「シフト外」として出る（仮アカウントの依頼主なので自社が承認する）
  await admin.goto("http://localhost:3000/company/settings?tab=workreports");
  const queueText = await admin.innerText("body");
  log("承認待ちに「シフト外」の印付きで並ぶ", queueText.includes("シフト外") && queueText.includes("シフト外スタッフ"));
  await admin.getByRole("button", { name: "承認する" }).click();
  await admin.waitForTimeout(800);
  log("通常の報告と同じく承認できる", psql(`select "approvalStatus" from "WorkReport" w join "Shift" s on s.id=w."shiftId" where s."staffUserId"='${staffUserId}';`) === "APPROVED");

  // 同じ時間帯にもう一度出そうとするとエラーになり、シフトも増えない
  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.getByRole("button", { name: "＋シフト外の勤務を報告する" }).click();
  const modal2 = staff.locator("div.fixed.inset-0.z-40").last();
  await modal2.locator("label", { hasText: "勤務日" }).locator("input").fill(yesterday);
  await modal2.locator("label", { hasText: "出勤" }).first().locator("input").fill("10:00");
  await modal2.locator("label", { hasText: "退勤" }).locator("input").fill("12:00");
  await modal2.getByRole("button", { name: "業務報告を提出する" }).click();
  await staff.waitForTimeout(800);
  log("既にシフトがある時間帯ではエラーになる", (await modal2.textContent()).includes("既にシフトがあります"));
  log("エラー時はシフトが増えない", psql(`select count(*) from "Shift" where "staffUserId"='${staffUserId}';`) === "1");

  console.log(process.exitCode ? "UNSCHEDULED WORKREPORT SMOKE TEST HAD FAILURES" : "UNSCHEDULED WORKREPORT SMOKE TEST PASSED");
} catch (err) {
  console.error("UNSCHEDULED WORKREPORT SMOKE TEST FAILED", err);
  await staff.screenshot({ path: "/tmp/smoke-unscheduled-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
