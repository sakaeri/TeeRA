import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";
import { loginViaEmail } from "./_lib/login.mjs";

// ・有料プランから「無料プランに戻す」：ほかのプランと同じく「このプランにする」で選べ、
//   今の期間の終わりに解約する予約になる（取り消しもできる）。履歴に残る
// ・無料プランの会社は、直近3か月より前のPDF（給料明細・一括・カレンダー）を会社側では見られない
//   （スタッフ本人の明細は見られる）

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
function monthsAgo(n) {
  const d = new Date(Date.now() + 9 * 3600e3);
  const p = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
  return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, "0")}`;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();
const staff = await (await browser.newContext()).newPage();
const suffix = Date.now();
const companyName = `プラン解約確認株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "解約本部");
  await admin.fill("#email", `pc-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  // ---- 無料プランに戻す（有料のビジネスプランから） ----
  psql(`update "Company" set "planTier"='BUSINESS' where id='${companyId}';`);
  psql(
    `insert into "StripeSubscription" (id, "companyId", "stripeSubscriptionId", "planTier", status, "updatedAt") values (gen_random_uuid()::text, '${companyId}', 'sub_local_${suffix}', 'BUSINESS', 'ACTIVE', now());`,
  );
  await admin.goto("http://localhost:3000/company/wallet");
  await admin.getByRole("button", { name: "プランを選ぶ" }).click();
  const freeRow = admin.locator("div.rounded-xl", { hasText: "無料プラン" }).first();
  await freeRow.getByRole("button", { name: "このプランにする" }).click();
  const confirm = admin.getByTestId("plan-free-confirm");
  await confirm.waitFor();
  const confirmText = await confirm.innerText();
  log("無料プランもほかのプランと同じく「このプランにする」で選べ、確認に期間の終わりまで使えることが出る", confirmText.includes("まで") && confirmText.includes("ビジネスプランのまま使えます"));
  await confirm.getByRole("button", { name: "無料プランに戻す" }).click();
  await admin.getByTestId("plan-cancel-scheduled").waitFor();
  log("期間の終わりに無料プランに戻る予約になる", psql(`select "cancelAtPeriodEnd" from "StripeSubscription" where "companyId"='${companyId}';`) === "t");
  log("期間の終わりまではビジネスプランのまま", psql(`select "planTier" from "Company" where id='${companyId}';`) === "BUSINESS");
  log("履歴に「無料プランに戻す申し込み」が残る", psql(`select count(*) from "PlanChangeEvent" where "companyId"='${companyId}' and reason='CANCEL_SCHEDULED';`) === "1");
  await admin.getByTestId("plan-cancel-scheduled").getByRole("button", { name: "取り消す" }).click();
  await admin.getByTestId("plan-cancel-scheduled").waitFor({ state: "detached" });
  log("取り消すと予約が外れる", psql(`select "cancelAtPeriodEnd" from "StripeSubscription" where "companyId"='${companyId}';`) === "f");
  log("取り消しも履歴に残る", psql(`select count(*) from "PlanChangeEvent" where "companyId"='${companyId}' and reason='CANCEL_UNDONE';`) === "1");

  // ---- 無料プランの3か月制限（PDF） ----
  psql(`update "StripeSubscription" set status='CANCELED' where "companyId"='${companyId}';`);
  psql(`update "Company" set "planTier"='FREE' where id='${companyId}';`);
  const staffId = psql(
    `with ins as (insert into "User" (id, email, "passwordHash", name, "emailVerified", "updatedAt") values (gen_random_uuid()::text, 'pc-staff-${suffix}@example.com', '\\$2b\\$10\\$/mEEG3MjInUs/GTnDFsVM./2.GDR18u06dgvlLCPnc1Xz2kVQRLga', '明細スタッフ', true, now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role, "payslipEConsentAt") values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF', now());`);
  const makeSlip = (month) => {
    const slip = psql(`insert into "SalarySlip" (id, "companyId", "staffUserId", "targetMonth", status, "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', '${month}', 'ISSUED', now()) returning id;`);
    psql(
      `insert into "SalarySlipIssue" (id, "salarySlipId", snapshot, "chargedTee", "issuedAt") values (gen_random_uuid()::text, '${slip}', jsonb_build_object('staffName','明細スタッフ','targetMonth','${month}','lines','[]'::jsonb,'deductions','[]'::jsonb,'paidLeaveDaysUsed',0,'paidLeaveDailyRate',0,'grossFromShifts',0,'paidLeaveAmount',0,'gross',0,'totalDeductions',0,'net',0,'issuedAt','2026-01-01T00:00:00.000Z'), true, now());`,
    );
    return slip;
  };
  const oldMonth = monthsAgo(4);
  const recentMonth = monthsAgo(1);
  const oldSlip = makeSlip(oldMonth);
  const recentSlip = makeSlip(recentMonth);

  const oldRes = await admin.request.get(`http://localhost:3000/api/salary-slips/${oldSlip}/pdf`);
  log("無料プランの会社は、3か月より前の給料明細のPDFを見られない", oldRes.status() === 403 && (await oldRes.text()).includes("直近3か月より前"));
  const recentRes = await admin.request.get(`http://localhost:3000/api/salary-slips/${recentSlip}/pdf`);
  log("直近の給料明細のPDFは見られる", recentRes.status() === 200);
  const bulkOld = await admin.request.get(`http://localhost:3000/api/salary-slips/bulk-pdf?month=${oldMonth}`);
  log("3か月より前の一括PDFも見られない", bulkOld.status() === 403);
  const [oy, om] = oldMonth.split("-").map(Number);
  const calOld = await admin.request.get(`http://localhost:3000/api/calendar/pdf?y=${oy}&m=${om}`);
  log("3か月より前のカレンダーのPDFも見られない", calOld.status() === 403);
  const [ry, rm] = recentMonth.split("-").map(Number);
  const calRecent = await admin.request.get(`http://localhost:3000/api/calendar/pdf?y=${ry}&m=${rm}`);
  log("直近のカレンダーのPDFは見られる", calRecent.status() === 200);

  // スタッフ本人は、会社が無料プランでも自分の昔の明細を見られる
  await loginViaEmail(staff, `pc-staff-${suffix}@example.com`, "password123");
  const staffOld = await staff.request.get(`http://localhost:3000/api/salary-slips/${oldSlip}/pdf`);
  log("スタッフ本人は3か月より前の自分の明細も見られる", staffOld.status() === 200);

  // 有料プランに戻すと、また見られる
  psql(`update "Company" set "planTier"='STANDARD' where id='${companyId}';`);
  const paidOld = await admin.request.get(`http://localhost:3000/api/salary-slips/${oldSlip}/pdf`);
  log("有料プランなら3か月より前のPDFも見られる", paidOld.status() === 200);

  console.log(process.exitCode ? "PLAN CANCEL / PDF CUTOFF SMOKE TEST HAD FAILURES" : "PLAN CANCEL / PDF CUTOFF SMOKE TEST PASSED");
} catch (e) {
  console.error(e);
  await admin.screenshot({ path: "/tmp/pc-admin-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
