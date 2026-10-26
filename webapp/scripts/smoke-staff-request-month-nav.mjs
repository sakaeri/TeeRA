import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// スタッフのシフト希望申請で、日付を選ぶカレンダーの月を前後に切り替えられることを検証する：
// ・開いた時はカレンダーで見ていた月
// ・次の月へ進めて日付を選べる。選んだ日付は月を切り替えても残る
// ・今月より前には戻れない

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
const staff = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const suffix = Date.now();
const companyName = `申請月切替確認株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "申請月切替管理者");
  await admin.fill("#email", `reqmonth-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  const staffEmail = `reqmonth-staff-${suffix}@example.com`;
  const staffId = psql(
    `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${staffEmail}', '\\$2b\\$10\\$/mEEG3MjInUs/GTnDFsVM./2.GDR18u06dgvlLCPnc1Xz2kVQRLga', '申請月切替スタッフ', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);

  await staff.goto("http://localhost:3000/login");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000 });

  const now = new Date(Date.now() + 9 * 3600e3);
  const [y, m] = [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const next = new Date(Date.UTC(y, m, 1));
  const [ny, nm] = [next.getUTCFullYear(), next.getUTCMonth() + 1];
  await staff.goto(`http://localhost:3000/staff?y=${y}&m=${m}`);
  await staff.waitForTimeout(800);
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

  log("開いた時はカレンダーで見ていた月", (await wizard.innerText()).includes(`${y}年${m}月`));
  log("今月より前には戻れない（前の月ボタンが押せない）", await wizard.getByRole("button", { name: "前の月" }).isDisabled());

  await wizard.getByRole("button", { name: "次の月" }).click();
  await staff.waitForTimeout(200);
  log("次の月へ進める", (await wizard.innerText()).includes(`${ny}年${nm}月`));
  await wizard.getByRole("button", { name: "15", exact: true }).click();
  log("次の月の日付を選べる", (await wizard.innerText()).includes("1日を選択中"));

  await wizard.getByRole("button", { name: "前の月" }).click();
  await staff.waitForTimeout(200);
  log("前の月に戻れる", (await wizard.innerText()).includes(`${y}年${m}月`));
  log("月を切り替えても選んだ日付は残る", (await wizard.innerText()).includes("1日を選択中"));

  console.log(process.exitCode ? "STAFF REQUEST MONTH NAV SMOKE TEST HAD FAILURES" : "STAFF REQUEST MONTH NAV SMOKE TEST PASSED");
} finally {
  await browser.close();
}
