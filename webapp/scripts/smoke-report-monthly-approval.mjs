import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 業務報告の承認のタイミング（仮の依頼主ごと：その都度／月末にまとめて）：
// ・依頼主の詳細で切り替えられる
// ・「月末にまとめて」の依頼主の今月分は、件数・やること・アイコンの数字・まとめメールに出さない
// ・先月分は「〇〇の◯月分の業務報告が◯件、未承認です」と1行で出て、タップした一覧から「まとめて承認」できる

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
const logSize = () => readFileSync("/tmp/nextdev.log").length;
const logSince = (o) => readFileSync("/tmp/nextdev.log").subarray(o).toString();

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();
const suffix = Date.now();
const companyName = `月まとめ確認株式会社${suffix}`;
const notifyEmail = `monthly-notify-${suffix}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "月まとめ本部");
  await admin.fill("#email", `monthly-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  psql(`update "Company" set "agencyEnabled"=true, "notificationEmail"='${notifyEmail}' where id='${companyId}';`);

  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "clientCompanyId", "proxyName", status, "createdAt") values (gen_random_uuid()::text, '${companyId}', '${companyId}', null, '月まとめゴルフ', 'ACTIVE', now()) returning id) select id from ins;`,
  );
  const staffId = psql(
    `with ins as (insert into "User" (id, email, name, "updatedAt") values (gen_random_uuid()::text, 'monthly-staff-${suffix}@example.com', '月まとめ花子', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);
  const report = (dateExpr) => {
    const shiftId = psql(
      `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'CLIENT', '${relId}', 'キャディ', ${dateExpr}, '08:00', '16:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
    );
    return psql(
      `with ins as (insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "computedMinutes", "submittedAt", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${shiftId}', '${staffId}', 'WORKED', 'PENDING', 480, now(), now(), now()) returning id) select id from ins;`,
    );
  };
  const lastMonthReport = report(`(date_trunc('month', (now() at time zone 'Asia/Tokyo'))::date - 5)`);
  const thisMonthReport = report(`(now() at time zone 'Asia/Tokyo')::date`);
  const lastMonth = Number(psql(`select to_char(date_trunc('month', (now() at time zone 'Asia/Tokyo'))::date - 5, 'FMMM');`));

  // 依頼主の詳細で「月末にまとめて」に切り替える
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.click("text=月まとめゴルフ");
  const panel = admin.locator("div.fixed.inset-0.z-30").last();
  // 設定はチームの紐付けと一緒に「編集」の中（普段は出しておかない）
  await panel.getByRole("button", { name: "チームとの紐付けを編集" }).waitFor({ timeout: 15000 });
  log("普段は承認のタイミングの選択欄を出さない", (await panel.getByLabel(/業務報告の承認/).count()) === 0);
  await panel.getByRole("button", { name: "チームとの紐付けを編集" }).click();
  const select = panel.getByLabel(/業務報告の承認/);
  log("初期値は「その都度」", (await select.inputValue()) === "EACH");
  await select.selectOption("MONTHLY");
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await panel.getByText("業務報告は月末にまとめて承認").waitFor({ timeout: 15000 });
  log("「月末にまとめて」にするとチームの横に表示される", true);
  log("依頼主の詳細で「月末にまとめて」に切り替えられる", psql(`select "reportApprovalTiming" from "CompanyRelationship" where id='${relId}';`) === "MONTHLY");

  // ダッシュボード：今月分は出さず、先月分だけまとめて出る
  await admin.goto("http://localhost:3000/company");
  const body = await admin.locator("main").innerText();
  log("業務報告未承認の件数は先月分の1件だけ（今月分は数えない）", /業務報告未承認\s*1\s*件/.test(body));
  log(`やることに「月まとめゴルフの${lastMonth}月分の業務報告が1件、未承認です」と出る`, body.includes(`月まとめゴルフの${lastMonth}月分の業務報告が1件、未承認です`));
  log("今月分はやることに出ない（チームごとのまとめにも入らない）", !body.includes("未承認の業務報告が"));
  const badge = (await (await admin.request.get("http://localhost:3000/api/app-badge")).json()).count;
  log("アイコンの数字にも今月分は入らない（先月分の1件）", badge === 1);

  // まとめメール：今月分は入れない（先月分があるので送られ、その中に今月分は無い）
  const offset = logSize();
  const hour = new Date(Date.now() + 9 * 3600e3 + 3600e3).getUTCHours();
  psql(`update "Company" set "workReportDigestHour"=${hour}, "workReportDigestSentAt"=now() - interval '1 day' where id='${companyId}';`);
  await fetch(`http://localhost:3000/api/cron/notifications?job=shift-start-reminders&now=${encodeURIComponent(new Date(Date.now() + 3600e3).toISOString())}`, {
    headers: { Authorization: "Bearer local-dev-cron-secret-not-for-production" },
  });
  await new Promise((r) => setTimeout(r, 1500));
  const mail = logSince(offset);
  const mailSection = mail.slice(mail.indexOf(`宛先=${notifyEmail}`));
  log("まとめメールには先月分だけで、未承認は1件と書かれる", mail.includes(`宛先=${notifyEmail}`) && mailSection.includes("<strong>1件</strong>の業務報告が届きました") && mailSection.includes("まだ承認していない報告は<strong>1件</strong>"));

  // タップすると、その依頼主のその月の分の一覧 → まとめて承認
  await admin.goto("http://localhost:3000/company");
  await admin.getByRole("link", { name: new RegExp(`月まとめゴルフの${lastMonth}月分`) }).click();
  await admin.getByText("業務報告未承認").first().waitFor({ timeout: 15000 });
  await admin.getByRole("button", { name: "1件をまとめて承認" }).click();
  await admin.getByRole("button", { name: "まとめて承認する" }).click();
  await admin.waitForTimeout(1500);
  log("まとめて承認すると承認済みになる", psql(`select "approvalStatus" from "WorkReport" where id='${lastMonthReport}';`) === "APPROVED");
  log("今月分は承認されずに残る", psql(`select "approvalStatus" from "WorkReport" where id='${thisMonthReport}';`) === "PENDING");

  // 「その都度」に戻すと今月分も普段通り出る
  psql(`update "CompanyRelationship" set "reportApprovalTiming"='EACH' where id='${relId}';`);
  await admin.goto("http://localhost:3000/company");
  log("「その都度」なら今月分もやることに出る", (await admin.locator("main").innerText()).includes("未承認の業務報告が1件あります"));

  console.log(process.exitCode ? "REPORT MONTHLY APPROVAL SMOKE TEST HAD FAILURES" : "REPORT MONTHLY APPROVAL SMOKE TEST PASSED");
} catch (err) {
  console.error("REPORT MONTHLY APPROVAL SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
