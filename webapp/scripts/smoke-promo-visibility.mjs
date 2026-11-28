import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 販促品の掲載先：
// ・「自社スタッフのみ」は自社のスタッフだけに見え、ほかの会社のスタッフは交換できない
// ・「フリー掲載」はほかの会社のスタッフにも「みんなの販促品」として見え、交換できる（送り先が伝わる確認つき）
// ・会社の注文一覧で、自社のスタッフでない人の注文に「外部」と出る
// ・販促品の登録画面で掲載先を選べる

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

async function registerCompany(page, name, email) {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "販促担当");
  await page.fill("#email", email);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", name);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  return psql(`select id from "Company" where name='${name}';`);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ownerA = await (await browser.newContext()).newPage();
const ownerB = await (await browser.newContext()).newPage();
const staffB = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
staffB.on("dialog", (d) => d.accept());
const suffix = Date.now();

try {
  const companyA = await registerCompany(ownerA, `販促A社${suffix}`, `pv-a-${suffix}@example.com`);
  const companyB = await registerCompany(ownerB, `販促B社${suffix}`, `pv-b-${suffix}@example.com`);

  // B社のスタッフ（A社には所属していない）
  await ownerB.goto("http://localhost:3000/company/roster");
  await ownerB.getByText("＋スタッフを追加").first().click();
  await ownerB.click("text=本アカウントを招待");
  await ownerB.getByRole("button", { name: "招待URLを発行する" }).click();
  await ownerB.waitForSelector("input[readonly]");
  const inviteUrl = await ownerB.locator("input[readonly]").inputValue();
  await staffB.goto(inviteUrl);
  await staffB.click("text=アカウントを作成して参加する");
  await staffB.fill("#name", "B社スタッフ");
  await staffB.fill("#email", `pv-staff-${suffix}@example.com`);
  await staffB.click("button[type=submit]");
  await staffB.waitForTimeout(400);
  await staffB.goto(extractMagicLinkFromLog());
  await staffB.waitForURL(new RegExp("/invite/"));
  await staffB.click("text=参加する");
  await staffB.waitForURL("http://localhost:3000/staff");
  const staffId = psql(`select id from "User" where email='pv-staff-${suffix}@example.com';`);
  psql(`insert into "StaffPointsLedgerEntry" (id, "staffUserId", type, points, "balanceAfter", "createdAt") values (gen_random_uuid()::text, '${staffId}', 'EARN_REPORT_APPROVAL', 100, 100, now());`);

  // A社の販促品：自社スタッフのみ・フリー掲載
  const addItem = (name, visibility) =>
    psql(
      `insert into "PromoItem" (id, "companyId", "imageUrl", name, "pointsCost", stock, visibility, "createdAt") values (gen_random_uuid()::text, '${companyA}', 'https://example.com/x.png', '${name}', 10, 5, '${visibility}', now()) returning id;`,
    );
  const ownOnlyId = addItem(`A社社員限定タオル${suffix}`, "OWN_STAFF");
  const publicId = addItem(`A社フリーキャップ${suffix}`, "PUBLIC");

  // A社の画面：掲載先の表示と、登録画面の選択
  await ownerA.goto("http://localhost:3000/company");
  await ownerA.locator("[data-dashboard-tabs]").getByText("販促品", { exact: true }).click();
  const badges = await ownerA.getByTestId("promo-visibility-badge").allInnerTexts();
  log("販促品の一覧に掲載先が出る", badges.includes("自社スタッフのみ") && badges.includes("フリー掲載"));
  await ownerA.getByRole("button", { name: "編集" }).first().click();
  const vis = ownerA.getByTestId("promo-visibility");
  await vis.waitFor();
  await vis.getByRole("radio", { name: /フリー掲載/ }).click();
  await ownerA.getByRole("button", { name: "保存する" }).click();
  await ownerA.waitForTimeout(800);
  log("登録画面で掲載先を変えられる", psql(`select visibility from "PromoItem" where id='${ownOnlyId}';`) === "PUBLIC");
  psql(`update "PromoItem" set visibility='OWN_STAFF' where id='${ownOnlyId}';`);

  // B社スタッフのポイント画面
  await staffB.goto("http://localhost:3000/staff/points");
  const pub = staffB.getByTestId("public-promo-items");
  await pub.waitFor();
  const pubText = await pub.innerText();
  log("ほかの会社のフリー掲載は「みんなの販促品」に出る", pubText.includes(`A社フリーキャップ${suffix}`));
  log("ほかの会社の自社スタッフのみは出ない", !(await staffB.locator("body").innerText()).includes(`A社社員限定タオル${suffix}`));

  // フリー掲載を交換する
  await pub.getByText(`A社フリーキャップ${suffix}`).click();
  await staffB.getByText(`提供：販促A社${suffix}`).waitFor();
  await staffB.getByPlaceholder("例：山田 太郎").fill("B社 太郎");
  await staffB.getByPlaceholder("例：123-4567").fill("100-0001");
  await staffB.getByPlaceholder("例：東京都渋谷区〇〇1-2-3").fill("東京都千代田区1-1");
  await staffB.getByPlaceholder("例：090-1234-5678").fill("090-0000-0000");
  await staffB.getByRole("button", { name: "この内容で交換する" }).click();
  await staffB.waitForTimeout(1500);
  log("ほかの会社のスタッフもフリー掲載を交換できる", psql(`select count(*) from "PromoRedemption" where "promoItemId"='${publicId}' and "staffUserId"='${staffId}';`) === "1");

  // A社の注文一覧に「外部」と出る
  await ownerA.goto("http://localhost:3000/company?open=promoOrders");
  await ownerA.getByTestId("promo-order-external").first().waitFor({ timeout: 15000 });
  log("自社のスタッフでない人の注文に「外部」と出る", (await ownerA.getByTestId("promo-order-external").count()) === 1);

  console.log(process.exitCode ? "PROMO VISIBILITY SMOKE TEST HAD FAILURES" : "PROMO VISIBILITY SMOKE TEST PASSED");
} catch (err) {
  console.error("PROMO VISIBILITY SMOKE TEST FAILED", err);
  await staffB.screenshot({ path: "/tmp/smoke-promo-visibility-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
