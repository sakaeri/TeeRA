import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";
import { loginViaEmail } from "./_lib/login.mjs";

// スタッフのシフト希望申請で、その会社に申請済みの日に薄く色が付き、選ぶと
// 「この日は申請済みですが、追加で申請しますか？」と注意が出る（申請自体はできる）。

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
const companyName = `申請済み確認株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "申請済み管理者");
  await admin.fill("#email", `already-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  const staffEmail = `already-staff-${suffix}@example.com`;
  const staffId = psql(
    `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${staffEmail}', '\\$2b\\$10\\$/mEEG3MjInUs/GTnDFsVM./2.GDR18u06dgvlLCPnc1Xz2kVQRLga', '申請済みスタッフ', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);
  // 来月の10日・12日に、備考「早番希望」で申請済み
  const ym = psql(`select to_char(date_trunc('month', (now() at time zone 'Asia/Tokyo')) + interval '1 month', 'YYYY-MM');`);
  const [y, m] = ym.split("-").map(Number);
  psql(`insert into "ShiftRequest" (id, "staffUserId", "companyId", desire, dates, status, note) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'WORK', ARRAY['${ym}-10','${ym}-12']::date[], 'PENDING', '早番希望');`);

  await loginViaEmail(staff, staffEmail, "password123");
  await staff.goto(`http://localhost:3000/staff?y=${y}&m=${m}`);
  await staff.waitForTimeout(1500);
  const popup = staff.locator("div.fixed.inset-0.z-30");
  if (await popup.count()) {
    await popup.last().getByRole("button", { name: "✕" }).click().catch(() => {});
    await staff.waitForTimeout(300);
  }
  await staff.getByRole("button", { name: "シフト希望を申請する" }).click();
  await staff.waitForTimeout(300);
  const wizard = staff.locator("div.fixed.inset-0").filter({ hasText: "シフト希望申請" }).last();
  await wizard.getByRole("button", { name: "出勤希望" }).click();
  await wizard.getByRole("button", { name: "次へ" }).click();
  await staff.waitForTimeout(300);

  const requested = (await wizard.locator("button[data-requested=true]").allInnerTexts()).map((t) => t.trim()).sort();
  log("申請済みの日（10日・12日）に色が付く", JSON.stringify(requested) === JSON.stringify(["10", "12"]));
  log("色の意味の説明が出る", (await wizard.innerText()).includes(`${companyName}に申請済みの日`));
  await wizard.getByRole("button", { name: "12", exact: true }).click();
  await wizard.getByRole("button", { name: "13", exact: true }).click();
  const warn = await staff.getByTestId("already-requested").innerText();
  log("申請済みの日を選ぶと、申請の内容つきで注意が出る", warn.includes("この日は申請済みですが、追加で申請しますか？") && warn.includes(`${m}/12（申請済み：出勤希望・備考：早番希望）`) && !warn.includes(`${m}/13`));
  await staff.screenshot({ path: "/tmp/already.png" });
  await wizard.getByRole("button", { name: "次へ" }).click();
  await wizard.getByRole("button", { name: /申請する/ }).last().click();
  await staff.waitForTimeout(1200);
  log("申請済みの日を含んでいても申請できる", psql(`select count(*) from "ShiftRequest" where "staffUserId"='${staffId}';`) === "2");

  console.log(process.exitCode ? "STAFF REQUEST ALREADY SMOKE TEST HAD FAILURES" : "STAFF REQUEST ALREADY SMOKE TEST PASSED");
} catch (e) {
  console.error(e);
  await staff.screenshot({ path: "/tmp/already-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
