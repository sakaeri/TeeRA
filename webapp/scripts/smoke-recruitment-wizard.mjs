import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { createRecruitmentViaWizard } from "./_lib/recruitmentWizard.mjs";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 募集の作成はシフトの作成と同じく1画面ずつ（業務内容→日付・時間→日付ごとの人数→確認）。
// 選んだ日付ごとに人数を変えられる（例：1日目は2名、2日目は1名）。

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`)
    .toString()
    .trim();
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const s = Date.now();
const name = `募集ウィザード${s}`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "担当者");
  await page.fill("#email", `rw-${s}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", name);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${name}';`);

  await page.goto("http://localhost:3000/company/calendar");
  await page.locator("button", { hasText: "＋" }).last().click();
  await page.getByText("募集を作成").click();
  const modal = await createRecruitmentViaWizard(page, { taskName: "ホール業務", extraDates: [15], counts: [2, 1], confirm: false });
  const confirmText = await modal.innerText();
  log("確認画面に日付ごとの人数と合計が出る", confirmText.includes("2日・合計3名") && confirmText.includes("2名") && confirmText.includes("1名"));
  await page.screenshot({ path: "/tmp/rw-confirm.png" });
  await modal.getByRole("button", { name: "2件の募集を作成" }).click();
  await page.waitForTimeout(1000);
  const rows = psql(`select title||'|'||"maxEntries" from "PublicRecruitment" where "companyId"='${companyId}' order by date;`).split("\n");
  log("日付ごとに別の人数で募集ができる（1日目2名・2日目1名）", rows.length === 2 && rows[0] === "ホール業務|2" && rows[1] === "ホール業務|1");
  log("新しく追加した業務内容は登録され、次から選べる", psql(`select count(*) from "CompanyPlacementRate" where "companyId"='${companyId}' and "taskName"='ホール業務';`) === "1");

  console.log(process.exitCode ? "RECRUITMENT WIZARD SMOKE TEST HAD FAILURES" : "RECRUITMENT WIZARD SMOKE TEST PASSED");
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "/tmp/rw-fail.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
