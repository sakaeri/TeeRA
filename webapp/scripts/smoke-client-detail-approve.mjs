import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 依頼主の詳細（稼働履歴）から業務報告を承認する
// ・「締め日にまとめて承認」の依頼主でも、行をタップして開いた詳細から1件ずつ承認できる
// ・「未承認数」をタップすると、その月の未承認を✅で選んでまとめて承認できる
// ・「時間・勤務先を直す」で業務内容も直せる（候補は勤務先の単価の業務内容）

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
const staff = await (await browser.newContext()).newPage();
const suffix = Date.now();
const adminEmail = `cdapprove-admin-${suffix}@example.com`;
const staffEmail = `cdapprove-staff-${suffix}@example.com`;
const companyName = `詳細承認確認株式会社${suffix}`;
const clientName = `まとめ承認倶楽部${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "詳細承認管理者");
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
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "詳細承認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffId = psql(`select id from "User" where email='${staffEmail.toLowerCase()}';`);

  // 仮の依頼主（締め日にまとめて承認）
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', clientName);
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(800);
  const relId = psql(`select id from "CompanyRelationship" where "proxyName"='${clientName}';`);
  psql(`update "CompanyRelationship" set "reportApprovalTiming"='MONTHLY' where id='${relId}';`);
  const commentAfter = () => psql(`update "WorkReport" set comment='ナイター延長で30分残業' where id='${reportIds[2]}';`);
  for (const name of ["キャディ", "研修"]) psql(`insert into "CompanyPlacementRate" (id, "companyId", "companyRelationshipId", "taskName") values (gen_random_uuid()::text, '${companyId}', '${relId}', '${name}');`);

  // 今月の1〜3日に承認待ちの業務報告を3件
  const reportIds = [];
  for (let i = 0; i < 3; i++) {
    const shiftId = psql(
      `insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", date, "startTime", "endTime", "taskName", status, "createdVia", "updatedAt") ` +
        `values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'CLIENT', '${relId}', date_trunc('month', (now() at time zone 'Asia/Tokyo'))::date + ${i}, '08:00', '17:00', 'キャディ', 'CONFIRMED', 'ASSIGN', now()) returning id;`,
    );
    reportIds.push(
      psql(
        `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "clockIn", "clockOut", "breakMinutes", "computedMinutes", "submittedAt", "approvalStatus", "createdAt", "updatedAt") ` +
          `values (gen_random_uuid()::text, '${shiftId}', '${staffId}', 'WORKED', (date_trunc('month', (now() at time zone 'Asia/Tokyo'))::date + ${i} + time '08:30') at time zone 'Asia/Tokyo', (date_trunc('month', (now() at time zone 'Asia/Tokyo'))::date + ${i} + time '16:30') at time zone 'Asia/Tokyo', 60, 420, now(), 'PENDING', now(), now()) returning id;`,
      ),
    );
  }

  commentAfter();
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.getByText(clientName).first().click();
  const bulkOpen = admin.getByTestId("bulk-approve-open");
  await bulkOpen.waitFor({ timeout: 20000 });
  log("未承認数が3件", (await bulkOpen.innerText()).includes("3"));

  // ①行をタップ → 詳細から承認
  const dialog = admin.getByRole("dialog").filter({ hasText: "業務報告の詳細" });
  await admin.getByText("詳細承認スタッフ").first().click();
  await dialog.getByTestId("report-approve-actions").waitFor({ timeout: 15000 });
  await dialog.getByRole("button", { name: "承認する" }).click();
  await dialog.getByTestId("report-action-done").waitFor({ timeout: 15000 });
  const approvedCount = () => Number(psql(`select count(*) from "WorkReport" where id in ('${reportIds.join("','")}') and "approvalStatus"='APPROVED';`));
  log("締め日にまとめて承認の依頼主でも、詳細から1件承認できる", approvedCount() === 1);
  await dialog.getByTestId("report-approve-actions").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  const dialogText = await dialog.innerText();
  log("承認すると詳細の表示が承認済みに変わり、ボタンが消える", dialogText.includes("承認済み") && (await dialog.getByTestId("report-approve-actions").count()) === 0);
  await dialog.getByRole("button", { name: "閉じる" }).click();
  await admin.waitForTimeout(800);
  log("未承認数が2件に減る", (await bulkOpen.innerText()).includes("2"));

  // ②未承認数 → まとめて承認（1件外す）
  await bulkOpen.click();
  const bulk = admin.getByRole("dialog", { name: "まとめて承認" });
  await bulk.waitFor();
  const bulkText = await bulk.innerText();
  log("まとめて承認の一覧は出勤〜退勤の時刻と実働を出す", bulkText.includes("08:30〜16:30") && bulkText.includes("実働 7時間00分"));
  log("コメント（備考）がある報告はコメントが出る", (await bulk.getByTestId("bulk-approve-comment").innerText()).includes("ナイター延長"));
  log("まとめて承認の一覧に未承認の2件が✅付きで出る", (await bulk.getByTestId("bulk-approve-list").locator('input[type="checkbox"]:checked').count()) === 2);
  await bulk.getByTestId("bulk-approve-list").locator('input[type="checkbox"]').first().uncheck();
  await bulk.getByRole("button", { name: "まとめて承認（1件）" }).click();
  await bulk.waitFor({ state: "detached", timeout: 15000 });
  log("✅を付けた分だけ承認される", approvedCount() === 2);
  await admin.waitForTimeout(800);
  log("未承認数が1件に減る", (await bulkOpen.innerText()).includes("1"));

  // ③残りの1件を「時間・勤務先を直す」で業務内容を直す
  const remaining = reportIds.find((id) => psql(`select "approvalStatus" from "WorkReport" where id='${id}';`) !== "APPROVED");
  const remainingDay = psql(`select to_char(s.date, 'MM-DD') from "WorkReport" w join "Shift" s on s.id=w."shiftId" where w.id='${remaining}';`);
  await admin.locator("button", { hasText: remainingDay }).filter({ hasText: "詳細承認スタッフ" }).first().click();
  await dialog.getByTestId("report-approve-actions").waitFor({ timeout: 15000 });
  await dialog.getByRole("button", { name: "時間・勤務先を直す" }).click();
  const taskSelect = dialog.getByTestId("correction-task-name");
  await taskSelect.waitFor({ timeout: 15000 });
  await admin.waitForTimeout(500);
  const taskOptions = (await taskSelect.locator("option").allInnerTexts()).filter((t) => t !== "未選択" && !t.startsWith("＋"));
  log(`業務内容の候補は勤務先の単価の業務内容：${taskOptions.join("/")}`, taskOptions.join("/") === "キャディ/研修");
  log("直している間は経緯を隠す", !(await dialog.innerText()).includes("経緯"));
  await admin.setViewportSize({ width: 390, height: 844 });
  await admin.screenshot({ path: process.env.SHOT ?? "/tmp/correct-form.png" });
  await taskSelect.selectOption("研修");
  await dialog.getByRole("button", { name: "保存してスタッフに確認してもらう" }).click();
  await dialog.getByTestId("report-action-done").waitFor({ timeout: 15000 });
  log("経緯には実際に直した項目（業務内容）だけが出る", psql(`select "correctionSummary" from "WorkReport" where id='${remaining}';`) === "業務内容");
  log("業務内容を直すと保存され、スタッフの確認待ちになる", psql(`select "taskName"||'|'||"approvalStatus" from "WorkReport" where id='${remaining}';`) === "研修|NEEDS_CONFIRMATION");

  // スタッフ側：直した後の内容（会社・勤務先・業務内容・時間）がそのまま出る
  await staff.goto("http://localhost:3000/staff/timecard");
  const corrected = staff.getByTestId("corrected-report").first();
  await corrected.waitFor({ timeout: 20000 });
  const correctedText = await corrected.innerText();
  log(`スタッフの確認欄に直した後の内容が出る（${correctedText.replace(/\n/g, " ")}）`, correctedText.includes(companyName) && correctedText.includes(clientName) && correctedText.includes("研修") && correctedText.includes("〜"));

  // カレンダーのポップアップで「内容が違う」→ 自分で直す時に勤務先も選び直せる
  await staff.goto("http://localhost:3000/staff");
  const popupCard = staff.locator("li").filter({ has: staff.getByTestId("corrected-report") }).first();
  await popupCard.waitFor({ timeout: 20000 });
  await popupCard.getByRole("button", { name: "内容が違う" }).click();
  await staff.waitForTimeout(1500);
  const popupWorkplace = staff.getByTestId("report-workplace").first();
  await popupWorkplace.waitFor({ timeout: 15000 }).catch(() => {});
  log("ポップアップで「内容が違う」を押した後も勤務先を選び直せる", (await popupWorkplace.count()) > 0 && (await popupWorkplace.locator("option").allInnerTexts()).includes(clientName));

  console.log(process.exitCode ? "CLIENT DETAIL APPROVE SMOKE TEST HAD FAILURES" : "CLIENT DETAIL APPROVE SMOKE TEST PASSED");
} catch (err) {
  console.error("CLIENT DETAIL APPROVE SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
