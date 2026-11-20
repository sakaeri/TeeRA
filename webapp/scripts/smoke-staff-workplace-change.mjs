import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// スタッフが業務報告で勤務先を変える（当日に別の現場へ回った等）：
// ・選べるのは社内と、本人が配属されている依頼主。依頼主のオーダーから入ったシフトでも変えられる
// ・提出すると新しい勤務先へ振り替わり（元のシフトは取消（振替）・オーダーの枠は空く）、承認画面に「A → B（スタッフが変更）」
// ・元の依頼主へのキャンセル料は、会社の「やること」に確認として出て、カレンダーの変更履歴から入れる（請求書に載る）
// シフト外の勤務の業務内容：最近使った業務内容・勤務先に登録された業務内容が候補に出て、押すと入る

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

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const suffix = Date.now();
const adminEmail = `wpchg-admin-${suffix}@example.com`;
const staffEmail = `wpchg-staff-${suffix}@example.com`;
const companyName = `勤務先変更確認株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "勤務先変更確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "勤務先変更確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffId = psql(`select id from "User" where email='${staffEmail.toLowerCase()}';`);

  // --- ①5日前の通常シフト（打刻無し）を手入力で報告できるか ---
  const pastDateStr = psql(`select ((now() at time zone 'Asia/Tokyo')::date - 2)::text;`);
  const rel = (name) =>
    psql(`insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") values (gen_random_uuid()::text, '${companyId}', '${companyId}', '${name}', 'ACTIVE', now()) returning id;`);
  const relA = rel("元ゴルフ倶楽部");
  const relB = rel("先ゴルフ倶楽部");
  const relC = rel("配属なし倶楽部");
  for (const r of [relA, relB]) psql(`insert into "StaffPlacement" (id, "staffUserId", "companyRelationshipId", active, "createdAt") values (gen_random_uuid()::text, '${staffId}', '${r}', true, now());`);
  psql(`insert into "CompanyPlacementRate" (id, "companyId", "companyRelationshipId", "taskName") values (gen_random_uuid()::text, '${companyId}', '${relB}', '先の登録業務');`);
  // 元ゴルフ倶楽部のオーダーから入ったシフト
  const recId = psql(
    `insert into "PublicRecruitment" (id, "companyId", "companyRelationshipId", title, date, "maxEntries", "lockedTee", status, visibility, "isUndecided", "extraItems", "publishedAt", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${relA}', 'キャディ', '${pastDateStr}', 1, 0, 'PUBLISHED', 'ORDER', false, '[]'::jsonb, now(), now(), now()) returning id;`,
  );
  const shiftId = psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "publicRecruitmentId", date, "startTime", "endTime", "taskName", status, "createdVia", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'CLIENT', '${relA}', '${recId}', '${pastDateStr}', '08:00', '17:00', 'キャディ', 'CONFIRMED', 'PUBLIC_RECRUIT_ENTRY', now()) returning id;`,
  );
  psql(`insert into "RecruitmentEntry" (id, "publicRecruitmentId", "staffUserId", status, "resultingShiftId") values (gen_random_uuid()::text, '${recId}', '${staffId}', 'CONFIRMED', '${shiftId}');`);

  // --- スタッフ：勤務先を「先ゴルフ倶楽部」に変えて提出 ---
  await staff.goto("http://localhost:3000/staff/timecard");
  const card = staff.locator("li", { hasText: pastDateStr }).first();
  const select = card.getByTestId("report-workplace");
  await select.waitFor();
  const options = await select.locator("option").allInnerTexts();
  log("勤務先は社内と配属されている依頼主だけ選べる", options.includes("社内") && options.includes("先ゴルフ倶楽部") && !options.includes("配属なし倶楽部"));
  await select.selectOption(relB);
  log("勤務先を変えると振替の案内が出る", (await card.innerText()).includes("この勤務先に振り替わります"));
  await card.locator('input[type="time"]').first().fill("08:00");
  await card.locator('input[type="time"]').nth(1).fill("17:00");
  await card.getByRole("button", { name: "業務報告を提出する" }).click();
  await staff.waitForTimeout(1500);

  const oldRow = psql(`select s.status||'|'||c."transferredByStaff"||'|'||c."feeReviewPending" from "Shift" s join "ShiftCancellation" c on c."shiftId"=s.id where s.id='${shiftId}';`);
  log("元のシフトは取消（振替）になり、キャンセル料の確認待ちになる", oldRow === "CANCELLED|true|true");
  log("元のオーダーの枠が空く", psql(`select status from "RecruitmentEntry" where "resultingShiftId"='${shiftId}';`) === "REJECTED");
  const newRow = psql(
    `select s."companyRelationshipId"||'|'||(w."submittedAt" is not null)||'|'||w."workplaceChangedFrom"||'|'||w."workplaceChangedByStaff" from "Shift" s join "WorkReport" w on w."shiftId"=s.id where s."staffUserId"='${staffId}' and s.status='CONFIRMED' and s.date='${pastDateStr}';`,
  );
  log("新しい勤務先のシフトに業務報告が移り、変更前の勤務先が記録される", newRow === `${relB}|true|元ゴルフ倶楽部|true`);

  // --- 会社：承認画面・やること・キャンセル料 ---
  await admin.goto("http://localhost:3000/company");
  await admin.waitForTimeout(1500);
  const dash = await admin.locator("body").innerText();
  log("やることに「振り替えました（キャンセル料を確認）」が出る", dash.includes("別の現場に振り替えました") && dash.includes("キャンセル料を確認"));
  await admin.getByText("業務報告未承認").first().click();
  await admin.waitForTimeout(800);
  const reportRow = admin.getByText("勤務先変更確認スタッフ").last();
  await reportRow.click();
  await admin.getByTestId("report-workplace").waitFor();
  log("承認画面に「元ゴルフ倶楽部 → 先ゴルフ倶楽部（スタッフが変更）」と出る", (await admin.getByTestId("report-workplace").innerText()).includes("元ゴルフ倶楽部 → 先ゴルフ倶楽部（スタッフが変更）"));

  await admin.goto(`http://localhost:3000/company/calendar?date=${pastDateStr}`);
  const review = admin.getByTestId("transfer-fee-review");
  await review.waitFor({ timeout: 20000 });
  await review.locator("input").fill("3000");
  await review.getByRole("button", { name: "記録する" }).click();
  await admin.waitForTimeout(1200);
  log("変更履歴からキャンセル料を記録すると、確認待ちが外れる", psql(`select "feeAmount"||'|'||"feeReviewPending" from "ShiftCancellation" where "shiftId"='${shiftId}';`) === "3000|false");

  // --- シフト外の勤務：業務内容の入力候補 ---
  await staff.goto("http://localhost:3000/staff/timecard?unscheduled=1");
  const modal = staff.locator("div.fixed").filter({ has: staff.getByTestId("task-suggestions") }).last();
  await staff.getByTestId("task-suggestions").waitFor({ timeout: 15000 }).catch(() => {});
  const chips = await staff.getByTestId("task-suggestions").innerText().catch(() => "");
  log("最近使った業務内容が候補に出る", chips.includes("キャディ"));
  await staff.getByTestId("task-suggestions").getByRole("button", { name: "キャディ" }).click();
  log("候補を押すと業務内容に入る", (await staff.locator('input[list="unscheduled-task-names"]').inputValue()) === "キャディ");
  void modal;

  console.log(process.exitCode ? "STAFF WORKPLACE CHANGE SMOKE TEST HAD FAILURES" : "STAFF WORKPLACE CHANGE SMOKE TEST PASSED");
} catch (err) {
  console.error("STAFF WORKPLACE CHANGE SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
