import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// スタッフのアプリの「給料明細」：
// ・会社が発行するとスタッフにお知らせが届く
// ・電子で受け取ることに同意するまでは、中身（PDF）を見られない
// ・同意すると発行済みの明細が月ごとに並び、PDFを開ける。再発行すると「修正済み」
// ・下書きの内容はスタッフからは見えない（発行した内容だけ）
// ・スタッフ用の「使い方」ページが開ける

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
const companyName = `明細共有確認株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "明細本部");
  await admin.fill("#email", `payslip-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  psql(`update "Company" set "planTier"='STANDARD' where id='${companyId}';`);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.getByText("＋スタッフを追加").first().click();
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "明細花子");
  await staff.fill("#email", `payslip-staff-${suffix}@example.com`);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffId = psql(`select id from "User" where email='payslip-staff-${suffix}@example.com';`);

  // 会社が給料明細を発行する
  const month = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
  await admin.goto(`http://localhost:3000/company/payroll?month=${month}&staff=${staffId}`);
  await admin.getByRole("button", { name: "PDFで明細を発行する", exact: true }).click();
  await admin.waitForTimeout(1500);
  const slipId = psql(`select id from "SalarySlip" where "staffUserId"='${staffId}' and "targetMonth"='${month}';`);
  log("会社が発行した", psql(`select status from "SalarySlip" where id='${slipId}';`) === "ISSUED");
  log("スタッフに「給料明細が届きました」のお知らせが届く", psql(`select count(*) from "StaffNotice" where "staffUserId"='${staffId}' and message like '%給料明細が届きました%';`) === "1");

  // 同意する前は中身を見られない
  const pdfUrl = `http://localhost:3000/api/salary-slips/${slipId}/pdf`;
  log("同意する前はPDFを開けない", (await staff.request.get(pdfUrl)).status() === 403);
  await staff.goto("http://localhost:3000/staff/payslips");
  const consent = staff.getByRole("button", { name: "電子で受け取ることに同意する" });
  await consent.waitFor({ timeout: 15000 });
  log("給料明細の画面に、電子で受け取ることへの同意が出る", true);
  await consent.click();
  const [y, m] = month.split("-").map(Number);
  await staff.getByText(`${y}年${m}月分`).first().waitFor({ timeout: 15000 });
  log("同意の記録が残る", psql(`select ("payslipEConsentAt" is not null)::text from "CompanyMembership" where "userId"='${staffId}';`) === "true");
  log("同意すると発行済みの明細が月ごとに並ぶ", (await staff.locator("main").innerText()).includes(`${y}年${m}月分`));
  const res = await staff.request.get(pdfUrl);
  log("同意するとPDFを開ける", res.status() === 200 && (res.headers()["content-type"] ?? "").includes("pdf"));

  // 下書きに戻しても、スタッフには発行した内容が出る（下書きは見えない）
  psql(`update "SalarySlip" set status='DRAFT' where id='${slipId}';`);
  log("下書きに戻してもスタッフは発行済みの内容を開ける", (await staff.request.get(pdfUrl)).status() === 200);
  // 再発行すると「修正済み」
  psql(`insert into "SalarySlipIssue" (id, "salarySlipId", snapshot, "chargedTee", "issuedAt") select gen_random_uuid()::text, id, (select snapshot from "SalarySlipIssue" where "salarySlipId"='${slipId}' limit 1), false, now() from "SalarySlip" where id='${slipId}';`);
  await staff.goto("http://localhost:3000/staff/payslips");
  await staff.getByText("修正済み").first().waitFor({ timeout: 15000 });
  log("再発行すると「修正済み」と出る", true);

  // ほかの人の明細は開けない
  const other = await (await browser.newContext()).newPage();
  const anon = await other.request.get(pdfUrl);
  log("ログインしていない人は開けない（ログイン画面になる）", !(anon.headers()["content-type"] ?? "").includes("pdf"));

  // 使い方
  await staff.goto("http://localhost:3000/staff/howto");
  const howto = await staff.locator("main").innerText();
  log("スタッフ用の使い方が開ける", howto.includes("タイムカード（勤務開始・勤務終了）") && howto.includes("給料明細を見る"));
  const broken = await staff.$$eval("img[src^='/howto/']", (imgs) => imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src));
  log("使い方の画像がすべて読み込める", broken.length === 0);
  await staff.getByRole("button", { name: /印刷・PDFで見る/ }).click();
  await staff.waitForURL(/staff-manual\.pdf/, { timeout: 15000 });
  log("スマホでは「印刷・PDFで見る」でスタッフ用マニュアルのPDFが開く", true);

  console.log(process.exitCode ? "STAFF PAYSLIPS SMOKE TEST HAD FAILURES" : "STAFF PAYSLIPS SMOKE TEST PASSED");
} catch (err) {
  console.error("STAFF PAYSLIPS SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
