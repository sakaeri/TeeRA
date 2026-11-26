import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// スタッフの単価の履歴（吉元さんの請求書の件）：
// ・最初に登録した単価も履歴に出る。履歴は1件ずつ「開始日を直す」「消す」ができ、計算し直される
// ・「単価を変更」は今の単価と同じ種類（日給）を選んだ状態で開く
// ・単価の開始日より前の勤務は基本給になっていることを知らせ、「最初の勤務日から使う」で直せる
// ・取引先の業務内容にない名前の単価は、取引先の業務内容から選んでそろえられる（似た名前が無くても）
// ・業務内容を追加する時、開始日より前に勤務があれば知らせ、最初の勤務日にできる
// ・届いたスタッフの請求書に、今の単価だと金額が変わる勤務・基本給で計算した勤務を出す

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
function addDays(dateStr, delta) {
  const d = new Date(dateStr + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();
admin.on("dialog", (d) => d.accept());
const staff = await (await browser.newContext()).newPage();
const suffix = Date.now();
const companyName = `単価履歴株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "単価履歴管理者");
  await admin.fill("#email", `srh-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "履歴ゴルフ場");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);
  const relId = psql(`select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' order by "createdAt" desc limit 1;`);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.getByText("＋スタッフを追加").first().click();
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "履歴委託スタッフ");
  await staff.fill("#email", `srh-staff-${suffix}@example.com`);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffId = psql(`select id from "User" where email='srh-staff-${suffix}@example.com';`);

  // 業務委託・基本給 日給11,000円
  const tpl = psql(
    `insert into "ContractTemplate" (id, "companyId", title, "employmentType", "workplaceType", "jobDescription", "scheduleType", "wageType", "wageAmount", "contractPeriodType", "contractStartDate", status, "updatedAt") values (gen_random_uuid()::text, '${companyId}', '業務委託契約', 'CONTRACTOR', 'INHOUSE', 'キャディ業務/その他', 'SHIFT', 'DAILY', 11000, 'INDEFINITE', '2026-01-01', 'LOCKED', now()) returning id;`,
  );
  const contractId = psql(
    `insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", "contractStartDate", status, "consentedAt", "updatedAt") values (gen_random_uuid()::text, '${tpl}', '${staffId}', 11000, '2026-01-01', 'ACTIVE', now(), now()) returning id;`,
  );
  psql(`insert into "StaffContractWageVersion" (id, "staffContractId", "wageAmount", "effectiveFrom") values (gen_random_uuid()::text, '${contractId}', 11000, '2026-01-01');`);

  const today = psql(`select to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM-DD');`);
  // 取引先の業務内容
  for (const name of ["キャディ業務", "キャディー", "作業", "研修"]) {
    psql(`insert into "CompanyPlacementRate" (id, "companyId", "companyRelationshipId", "taskName") values (gen_random_uuid()::text, '${companyId}', '${relId}', '${name}');`);
  }
  const addRate = (taskName, versions) => {
    const id = psql(
      `insert into "StaffTaskRate" (id, "companyId", "staffUserId", "taskName", "companyRelationshipId") values (gen_random_uuid()::text, '${companyId}', '${staffId}', '${taskName}', '${relId}') returning id;`,
    );
    versions.forEach(([type, amount, from], i) => {
      psql(
        `insert into "StaffTaskRateVersion" (id, "staffTaskRateId", "wageType", amount, "effectiveFrom", "createdAt") values (gen_random_uuid()::text, '${id}', '${type}', ${amount}, '${from}', now() + interval '${i} second');`,
      );
    });
    return id;
  };
  // カヌチャ相当：最初に時給12,000円（間違い）を入れ、あとから日給12,000円を入れた
  const caddyRate = addRate("キャディ業務", [["HOURLY", 12000, addDays(today, -40)], ["DAILY", 12000, addDays(today, -20)]]);
  // アコーディア相当：日給14,000円を1回だけ、勤務より後の日付から
  const accRate = addRate("キャディー", [["DAILY", 14000, addDays(today, -5)]]);
  // 取引先の業務内容にない名前（似た名前も無い）
  const porterRate = addRate("セルフポーター作業", [["DAILY", 14000, addDays(today, -60)]]);

  const addWork = (date, taskName, minutes) => {
    const shiftId = psql(
      `insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'CLIENT', '${relId}', '${taskName}', '${date}', '07:00', '14:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id;`,
    );
    psql(
      `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "computedMinutes", "submittedAt", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${shiftId}', '${staffId}', 'WORKED', 'APPROVED', ${minutes}, now(), now(), now());`,
    );
    return shiftId;
  };
  const caddyShift = addWork(addDays(today, -30), "キャディ業務", 390);
  const accShift = addWork(addDays(today, -10), "キャディー", 360);
  addWork(addDays(today, -15), "研修", 240);

  // 届いた請求書（提出した時の金額：キャディ業務は時給で78,000円、キャディーは基本給11,000円）
  const workLines = JSON.stringify([
    { shiftId: caddyShift, description: `${addDays(today, -30)} 勤務（キャディ業務）`, hours: 6.5, rate: 12000, amount: 78000 },
    { shiftId: accShift, description: `${addDays(today, -10)} 勤務（キャディー）（日給）`, hours: 1, rate: 11000, amount: 11000 },
  ]);
  const month = today.slice(0, 7);
  const invoiceId = psql(
    `insert into "StaffInvoice" (id, "companyId", "staffUserId", "targetMonth", status, "workLines", "workSubtotal", total, "submittedAt", "openedAt", "chargeSettledAt", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', '${month}', 'SUBMITTED', '${workLines}'::jsonb, 89000, 89000, now(), now(), now(), now()) returning id;`,
  );
  await admin.goto(`http://localhost:3000/company/payroll?month=${month}&staffInvoice=${invoiceId}`);
  await admin.getByTestId("received-staff-invoice").waitFor();
  log("届いた請求書：単価が変わっていなければ、金額が変わる勤務の案内は出ない", (await admin.getByTestId("received-invoice-rate-changed").count()) === 0);
  log("届いた請求書：基本給で計算した勤務と、開始日の直し方を出す", (await admin.getByTestId("received-invoice-unresolved").count()) === 1);

  // --- スタッフ詳細の業務内容単価 ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=履歴委託スタッフ");
  const panel = admin.locator("div.fixed.inset-0.z-30").last();
  await panel.getByRole("button", { name: "業務内容単価" }).click();
  const card = (name) =>
    panel.getByTestId("staff-rate-card").filter({ has: admin.locator("span.block.truncate", { hasText: new RegExp(`^${name}$`) }) });
  await card("キャディ業務").waitFor();
  const modal = admin.locator("div.fixed.inset-0.z-40").last();

  // 1) 単価を変更：日給を選んだ状態・最初の時給の単価も履歴に出る
  await card("キャディ業務").getByRole("button", { name: "単価を変更" }).click();
  await modal.getByTestId("rate-history").waitFor();
  log("「単価を変更」は今の単価と同じ種類（日給）を選んだ状態で開く", (await modal.locator("select").first().inputValue()) === "DAILY");
  const historyText = await modal.getByTestId("rate-history").textContent();
  log("最初に登録した単価（時給12000円）も履歴に出る", (await modal.getByTestId("rate-history-row").count()) === 2 && historyText.includes("時給12000円"));

  // 2) 間違えた時給の履歴を消す → 30日前の勤務は日給の単価より前なので基本給になる
  await modal.getByTestId("rate-history-row").filter({ hasText: "時給12000円" }).getByRole("button", { name: "消す" }).click();
  await admin.waitForTimeout(800);
  log("履歴を1件消せる", psql(`select count(*) from "StaffTaskRateVersion" where "staffTaskRateId"='${caddyRate}';`) === "1");
  log("最後の1件は「消す」が出ない", (await modal.getByTestId("rate-history-row").getByRole("button", { name: "消す" }).count()) === 0);

  // 3) 残った日給の開始日を40日前に直す → 30日前の勤務も日給12,000円
  await modal.getByTestId("rate-history-row").getByRole("button", { name: "開始日を直す" }).click();
  await modal.getByLabel("新しい開始日").fill(addDays(today, -40));
  await modal.getByTestId("rate-history-row").getByRole("button", { name: "保存" }).click();
  await admin.waitForTimeout(800);
  log(
    "履歴の開始日を直せる",
    psql(`select to_char("effectiveFrom",'YYYY-MM-DD') from "StaffTaskRateVersion" where "staffTaskRateId"='${caddyRate}';`) === addDays(today, -40),
  );
  await modal.getByRole("button", { name: "閉じる" }).click();

  // 4) キャディー：開始日より前の勤務がある → 最初の勤務日から使う
  log("開始日より前の勤務が基本給になっていることを単価の行に出す", (await card("キャディー").getByTestId("staff-rate-before-start").count()) === 1);
  await card("キャディー").getByRole("button", { name: "単価を変更" }).click();
  await modal.getByTestId("rate-before-start").getByRole("button").click();
  await admin.waitForTimeout(800);
  log(
    "「最初の勤務日から使う」で開始日がその勤務日になる",
    psql(`select to_char(min("effectiveFrom"),'YYYY-MM-DD') from "StaffTaskRateVersion" where "staffTaskRateId"='${accRate}';`) === addDays(today, -10),
  );
  await modal.getByRole("button", { name: "閉じる" }).click();

  // 5) セルフポーター作業 → 作業 にそろえる（似た名前が無くても選べる）
  const pick = card("セルフポーター作業").getByTestId("staff-rate-align-pick");
  log("取引先の業務内容にない名前の単価に、そろえる先を選ぶ欄が出る", (await pick.count()) === 1);
  await pick.locator("select").selectOption("作業");
  await pick.getByRole("button", { name: "にそろえる" }).click();
  await admin.waitForTimeout(800);
  log("選んだ取引先の業務内容にそろう（単価はそのまま）", psql(`select "taskName" from "StaffTaskRate" where id='${porterRate}';`) === "作業");

  // 6) 業務内容を追加：開始日（今日）より前に勤務がある → 知らせて、最初の勤務日にできる
  await panel.getByRole("button", { name: "＋業務内容を追加" }).click();
  const form = admin.locator("div.fixed.inset-0.z-40").last();
  await form.locator("select").first().selectOption(relId);
  await form.getByTestId("new-rate-task").selectOption("研修");
  await form.getByTestId("new-rate-before-start").waitFor({ timeout: 5000 });
  log("追加する時、開始日より前の勤務があると知らせる", (await form.getByTestId("new-rate-before-start").count()) === 1);
  await form.getByTestId("new-rate-before-start").getByRole("button").click();
  log("「最初の勤務日からにする」で開始日が入る", (await form.locator('input[type=date]').inputValue()) === addDays(today, -15));
  log("追加する時の種類は基本給と同じ（日給）", (await form.locator("select").nth(2).inputValue()) === "DAILY");

  // 7) 単価を直した後、届いた請求書の「基本給で計算した勤務」は消え、金額が変わる勤務に出る
  await admin.goto(`http://localhost:3000/company/payroll?month=${month}&staffInvoice=${invoiceId}`);
  await admin.getByTestId("received-staff-invoice").waitFor();
  const changedAfter = (await admin.getByTestId("received-invoice-rate-changed").textContent().catch(() => "")) ?? "";
  log(
    "直した後：78,000円→12,000円、11,000円→14,000円と出る",
    changedAfter.includes("78,000円 → 12,000円") && changedAfter.includes("11,000円 → 14,000円"),
  );
  log("直した後：基本給で計算した勤務は無くなる", (await admin.getByTestId("received-invoice-unresolved").count()) === 0);

  console.log(process.exitCode ? "STAFF RATE HISTORY SMOKE TEST HAD FAILURES" : "STAFF RATE HISTORY SMOKE TEST PASSED");
} catch (err) {
  console.error("STAFF RATE HISTORY SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-staff-rate-history-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
