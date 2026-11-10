import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 使い方マニュアルのPDF（会社向け public/howto/manual.pdf・スタッフ向け public/howto/staff-manual.pdf）を作り直す。ホーム画面に追加したアプリでは
// 印刷ができないため、スマホではこのPDFを開いて「保存・共有」から印刷・保存してもらう。
// マニュアル（SettingsViewのHowToSection・StaffHowTo）の内容を直したら、devサーバーを起動して
//   node scripts/generate-manual-pdf.mjs
// を実行し、できたPDFも一緒にコミットする。
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
try {
  const suffix = Date.now();
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "マニュアル作成");
  await page.fill("#email", `manual-pdf-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(500);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", `マニュアル作成用${suffix}`);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  await page.goto("http://localhost:3000/company/settings");
  await page.click("text=使い方");
  await page.waitForTimeout(1500);
  await page.pdf({ path: "public/howto/manual.pdf", format: "A4", printBackground: true });
  console.log("public/howto/manual.pdf を作り直しました");

  // スタッフ向け：同じ人をシフトに入れる設定にして、スタッフの画面の「使い方」を開く
  execSync(
    `PGPASSWORD=postgres psql -h localhost -U postgres -d teera -c "update \\"CompanyMembership\\" set \\"canWorkShifts\\"=true where \\"userId\\"=(select id from \\"User\\" where email='manual-pdf-${suffix}@example.com');"`,
  );
  await page.goto("http://localhost:3000/staff/howto");
  await page.waitForTimeout(2000);
  await page.pdf({ path: "public/howto/staff-manual.pdf", format: "A4", printBackground: true });
  console.log("public/howto/staff-manual.pdf を作り直しました");
} finally {
  await browser.close();
}
