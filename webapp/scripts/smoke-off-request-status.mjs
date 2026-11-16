import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";
import { loginViaEmail } from "./_lib/login.mjs";

// 休み希望：会社の「休みで確定」「見送る」と、スタッフ側の表示（申請中＝薄い青、休みで確定＝グレー）・取り消し

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
const staff = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
const suffix = Date.now();
const companyName = `休み確定株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "休み確定管理者");
  await admin.fill("#email", `offst-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  const staffEmail = `offst-staff-${suffix}@example.com`;
  const staffId = psql(
    `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${staffEmail}', '\\$2b\\$10\\$/mEEG3MjInUs/GTnDFsVM./2.GDR18u06dgvlLCPnc1Xz2kVQRLga', '休み確定スタッフ', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);
  const ym = psql(`select to_char(date_trunc('month', (now() at time zone 'Asia/Tokyo')) + interval '1 month', 'YYYY-MM');`);
  const [y, m] = ym.split("-").map(Number);
  psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'OFF', ARRAY['${ym}-20']::date[], 'PENDING');`);
  psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'OFF', ARRAY['${ym}-22']::date[], 'PENDING');`);
  psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'WORK', ARRAY['${ym}-10']::date[], 'PENDING');`);

  // --- スタッフ：申請中は薄い青 ---
  await loginViaEmail(staff, staffEmail, "password123");
  const openStaffCalendar = async () => {
    await staff.goto(`http://localhost:3000/staff?y=${y}&m=${m}`);
    await staff.waitForTimeout(1500);
    const popup = staff.locator("div.fixed.inset-0.z-30");
    if (await popup.count()) {
      await popup.last().getByRole("button", { name: "✕" }).click().catch(() => {});
      await staff.waitForTimeout(300);
    }
  };
  await openStaffCalendar();
  const tags = async () => (await staff.locator("[data-request-tag]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-request-tag")}:${e.textContent}`))).sort();
  log("申請中は薄い青（出勤申請中・休み申請中）", JSON.stringify(await tags()) === JSON.stringify(["off-pending:休み申請中", "off-pending:休み申請中", "work-pending:出勤申請中"]));
  await staff.screenshot({ path: "/tmp/offst-staff-pending.png" });

  // --- 会社：20日は「休みで確定」、22日は「見送る」 ---
  await admin.goto("http://localhost:3000/company?open=unconfirmed");
  await admin.waitForTimeout(2500);
  const offCards = admin.getByTestId("unconfirmed-card").filter({ hasText: "（休み希望）" });
  await offCards.filter({ hasText: "備考" }).count();
  // カードはカレンダーの日で見分ける
  const card20 = offCards.filter({ has: admin.locator("[data-requested=true]", { hasText: /^20$/ }) });
  const card22 = offCards.filter({ has: admin.locator("[data-requested=true]", { hasText: /^22$/ }) });
  await card20.getByTestId("acknowledge-off-request").click();
  await card22.getByTestId("dismiss-off-request").click();
  await admin.waitForTimeout(1500);
  log("休みで確定・見送るで、休み希望のカードが両方消える", (await admin.getByTestId("unconfirmed-card").filter({ hasText: "（休み希望）" }).count()) === 0);
  log("20日は確定、22日は見送り", psql(`select string_agg(to_char(dates[1], 'DD') || ':' || status || ':' || ("acknowledgedAt" is not null), ',' order by dates[1]) from "ShiftRequest" where "staffUserId"='${staffId}' and desire='OFF';`) === "20:PENDING:true,22:DISMISSED:false");

  // --- スタッフ：休みで確定はグレーの「休み」、見送りはカレンダーに出ず詳細に出る ---
  await openStaffCalendar();
  log("休みで確定した日はグレーの「休み」", JSON.stringify(await tags()) === JSON.stringify(["off-confirmed:休み", "work-pending:出勤申請中"]));
  await staff.screenshot({ path: "/tmp/offst-staff-confirmed.png" });
  const dayCell = (d) => staff.locator(`button:has(span:text-is("${d}"))`).first();
  await dayCell(22).click();
  await staff.waitForTimeout(500);
  log("見送られた日は詳細に「休みは見送られました」", (await staff.locator("body").innerText()).includes("休みは見送られました"));
  await staff.keyboard.press("Escape");
  await openStaffCalendar();

  // --- スタッフ：確定した休みを取り消す ---
  await dayCell(20).click();
  await staff.waitForTimeout(500);
  await staff.getByText("休み（会社が確定しました）").click();
  await staff.getByTestId("cancel-request").click();
  log("確定した休みの取り消しは、会社に知らせる旨が出る", (await staff.locator("body").innerText()).includes("会社が確定した休みです。取り消すと会社に知らせます"));
  await staff.getByTestId("cancel-request-confirm").click();
  await staff.waitForTimeout(1500);
  log("取り消すと申請が消える", psql(`select count(*) from "ShiftRequest" where "staffUserId"='${staffId}' and desire='OFF' and status='PENDING';`) === "0");

  // --- スタッフ：出勤申請も取り消せる ---
  await openStaffCalendar();
  await dayCell(10).click();
  await staff.waitForTimeout(500);
  await staff.getByText("出勤申請中（会社の回答待ち）").click();
  await staff.getByTestId("cancel-request").click();
  await staff.getByTestId("cancel-request-confirm").click();
  await staff.waitForTimeout(1500);
  log("出勤申請も取り消せる", psql(`select count(*) from "ShiftRequest" where "staffUserId"='${staffId}' and desire='WORK';`) === "0");

  console.log(process.exitCode ? "OFF REQUEST STATUS SMOKE TEST HAD FAILURES" : "OFF REQUEST STATUS SMOKE TEST PASSED");
} catch (e) {
  console.error(e);
  await staff.screenshot({ path: "/tmp/offst-fail.png" }).catch(() => {});
  await admin.screenshot({ path: "/tmp/offst-fail-admin.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
