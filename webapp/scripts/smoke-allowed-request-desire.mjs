import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";
import { loginViaEmail } from "./_lib/login.mjs";

// 会社がスタッフごとに「シフト希望の申請」（自由選択／出勤のみ／休みのみ）を決められる。
// 1種類だけにすると、スタッフの申請画面では選ぶ画面を飛ばして、その希望で申請する。

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
const companyName = `希望種類株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "種類管理者");
  await admin.fill("#email", `rdesire-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  const staffEmail = `rdesire-staff-${suffix}@example.com`;
  const staffId = psql(
    `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${staffEmail}', '\\$2b\\$10\\$/mEEG3MjInUs/GTnDFsVM./2.GDR18u06dgvlLCPnc1Xz2kVQRLga', '種類スタッフ', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);
  const ym = psql(`select to_char(date_trunc('month', (now() at time zone 'Asia/Tokyo')) + interval '1 month', 'YYYY-MM');`);
  const [y, m] = ym.split("-").map(Number);

  // --- 会社：名簿のスタッフ詳細で「休みのみ」にする ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.waitForTimeout(2000);
  await admin.locator("tbody tr", { hasText: "種類スタッフ" }).click();
  await admin.waitForTimeout(500);
  await admin.locator("div.fixed.inset-0.z-30").first().getByRole("button", { name: "契約書管理" }).click();
  const setting = admin.getByTestId("allowed-request-desire");
  await setting.waitFor({ timeout: 60000 });
  log("最初は「自由選択」", (await setting.getByRole("button", { name: "自由選択" }).getAttribute("aria-pressed")) === "true");
  await setting.getByRole("button", { name: "休みのみ" }).click();
  await admin.waitForTimeout(1500);
  log("設定が保存される", psql(`select "allowedRequestDesire" from "CompanyMembership" where "userId"='${staffId}';`) === "OFF");
  await admin.screenshot({ path: "/tmp/rdesire-admin.png" });

  // --- スタッフ：選ぶ画面を飛ばして、休み希望で申請する ---
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
  const text = await wizard.innerText();
  log("出勤希望・休み希望を選ぶ画面は出ない", !text.includes("出勤希望・休み希望を選んでください") && text.includes("日付を選んでください"));
  log("休み希望で申請することが分かる", text.includes("休み希望"));
  log("戻るボタンは出ない（戻る先が無い）", (await wizard.getByRole("button", { name: "戻る" }).count()) === 0);
  await staff.screenshot({ path: "/tmp/rdesire-staff.png" });
  await wizard.getByRole("button", { name: "15", exact: true }).click();
  await wizard.getByRole("button", { name: "次へ" }).click();
  await wizard.getByRole("button", { name: /申請する/ }).last().click();
  await staff.waitForTimeout(1200);
  log("休み希望として申請される", psql(`select desire from "ShiftRequest" where "staffUserId"='${staffId}';`) === "OFF");

  // --- 会社：「自由選択」に戻すと、スタッフは選べるようになる ---
  await setting.getByRole("button", { name: "自由選択" }).click();
  await admin.waitForTimeout(1500);
  await staff.reload();
  await staff.waitForTimeout(1500);
  await staff.getByRole("button", { name: "シフト希望を申請する" }).click();
  await staff.waitForTimeout(300);
  log("両方に戻すと、選ぶ画面が出る", (await wizard.innerText()).includes("出勤希望・休み希望を選んでください"));

  console.log(process.exitCode ? "REQUEST DESIRE SMOKE TEST HAD FAILURES" : "REQUEST DESIRE SMOKE TEST PASSED");
} catch (e) {
  console.error(e);
  await staff.screenshot({ path: "/tmp/rdesire-fail.png" }).catch(() => {});
  await admin.screenshot({ path: "/tmp/rdesire-fail-admin.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
