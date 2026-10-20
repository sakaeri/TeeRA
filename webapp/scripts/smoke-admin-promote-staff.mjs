import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 既に所属しているスタッフを、設定＞本部メンバー権限の「＋招待」→
// 「既存スタッフから選ぶ」で本部管理者に格上げできるかを検証する（以前は
// 招待URLしかなく、既存スタッフが開くと「設定から変更して」と案内されるのに
// 設定側に変更手段が無い行き止まりだった）。

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
const page = await (await browser.newContext()).newPage();
const suffix = Date.now();
const companyName = `格上げ確認株式会社${suffix}`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "格上げ確認管理者");
  await page.fill("#email", `promote-admin-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  const staffId = psql(
    `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'promote-staff-${suffix}@example.com', 'x', '格上げ対象スタッフ', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF');`);

  await page.goto("http://localhost:3000/company/settings");
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "＋招待" }).first().click();
  log("「新しく招待する」と「既存スタッフから選ぶ」が選べる",
    (await page.getByRole("button", { name: "新しく招待する（URLを発行）" }).count()) === 1 &&
      (await page.getByRole("button", { name: "既存スタッフから選ぶ" }).count()) === 1);
  await page.getByRole("button", { name: "既存スタッフから選ぶ" }).click();
  const select = page.getByLabel("本部管理者にするスタッフ");
  const options = await select.locator("option").allTextContents();
  log("既存スタッフが候補に出て、本部管理者自身は出ない", options.includes("格上げ対象スタッフ") && !options.includes("格上げ確認管理者"));
  await select.selectOption({ label: "格上げ対象スタッフ" });
  await page.getByRole("button", { name: "本部管理者にする" }).click();
  await page.waitForTimeout(1000);
  const row = psql(`select role || '|' || "canWorkShifts" from "CompanyMembership" where "userId"='${staffId}' and "companyId"='${companyId}';`);
  log("本部管理者になり、シフトにも入れる設定になる", row === "COMPANY_ADMIN|true");
  log("本部メンバー一覧に表示される", (await page.locator("main").innerText()).includes("格上げ対象スタッフ"));

  console.log(process.exitCode ? "ADMIN PROMOTE STAFF SMOKE TEST HAD FAILURES" : "ADMIN PROMOTE STAFF SMOKE TEST PASSED");
} finally {
  await browser.close();
}
