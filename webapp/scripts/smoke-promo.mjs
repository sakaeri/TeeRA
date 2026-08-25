import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(
    `PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`,
  )
    .toString()
    .trim();
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminEmail = `promo-admin-${Date.now()}@example.com`;
const staffEmail = `promo-staff-${Date.now()}@example.com`;
const today = new Date().toISOString().slice(0, 10);

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "販促品管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "販促品テスト株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  const companyId = psql(
    `select cm."companyId" from "CompanyMembership" cm join "User" u on cm."userId"=u.id where u.email='${adminEmail}';`,
  );

  // seed a promo item directly (Blob upload token isn't available in this
  // local sandbox — the /api/upload route itself is unchanged by this UI
  // redesign and already verified working in production)
  psql(
    `insert into "PromoItem" (id, "companyId", "imageUrl", name, "pointsCost", stock, description, "createdAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', 'https://example.com/mug.png', 'オリジナルタオル', 1, 2, '夏用タオル', now());`,
  );
  const itemId = psql(`select id from "PromoItem" where "companyId"='${companyId}' and name='オリジナルタオル';`);

  // admin: item appears in list
  await admin.goto("http://localhost:3000/company");
  await admin.click("text=販促品一覧");
  let body = await admin.textContent("body");
  log("seeded promo item appears in list", body.includes("オリジナルタオル"));

  // admin: edit modal opens pre-filled, edit name, save
  await admin.getByRole("button", { name: "編集" }).click();
  await admin.waitForTimeout(300);
  body = await admin.textContent("body");
  log("edit modal pre-filled", body.includes("販促品を編集") && body.includes("夏用タオル"));

  await admin.fill('input[placeholder="例：オリジナルタオル"]', "オリジナルタオルSサイズ");
  await admin.getByRole("button", { name: "保存する" }).click();
  await admin.waitForTimeout(600);
  body = await admin.textContent("body");
  log("edit saved, new name shown in list", body.includes("オリジナルタオルSサイズ"));

  // invite + register staff
  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを招待する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "販促品スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  // shift + report + approve to earn 1pt
  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  const assignModal1 = admin.locator("div.fixed.inset-0.z-20").last();
  await assignModal1.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await assignModal1.getByRole("button", { name: "販促品スタッフ" }).click();
  await assignModal1.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal1.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  await staff.goto("http://localhost:3000/staff/timecard");
  await staff.getByRole("button", { name: "出勤" }).click();
  await staff.waitForTimeout(400);
  await staff.getByRole("button", { name: "退勤" }).click();
  await staff.waitForTimeout(400);
  await staff.getByRole("button", { name: "業務報告を提出する" }).click();
  await staff.waitForTimeout(600);

  await admin.goto("http://localhost:3000/company/settings?tab=workreports");
  await admin.getByRole("button", { name: "承認する" }).click();
  await admin.waitForTimeout(600);

  // staff checks points page
  await staff.goto("http://localhost:3000/staff/points");
  body = await staff.textContent("body");
  log("staff has 1pt", body.includes("1pt") && body.includes("承認済み業務報告 1件"));

  // redeem: opens shipping-info modal, fill address/phone, confirm
  await staff.getByRole("button", { name: "交換する" }).click();
  await staff.waitForTimeout(300);
  body = await staff.textContent("body");
  log("shipping info modal opens", body.includes("配送先を確認"));

  await staff.fill('input[placeholder="例：東京都渋谷区〇〇1-2-3"]', "東京都新宿区テスト1-1-1");
  await staff.fill('input[placeholder="例：090-1234-5678"]', "090-0000-1111");
  await staff.getByRole("button", { name: "この内容で交換する" }).click();
  await staff.waitForTimeout(700);
  body = await staff.textContent("body");
  log("item now shows as redeemed", body.includes("交換済み"));

  await staff.click("text=交換履歴");
  body = await staff.textContent("body");
  log("redemption appears in order history as 発送待ち", body.includes("オリジナルタオル") && body.includes("発送待ち"));

  // balance should be back to 0
  await staff.goto("http://localhost:3000/staff/points");
  body = await staff.textContent("body");
  log("balance back to 0pt after redemption", body.includes("0pt"));

  // admin sees reduced stock via edit modal
  await admin.goto("http://localhost:3000/company");
  await admin.click("text=販促品一覧");
  await admin.getByRole("button", { name: "編集" }).click();
  await admin.waitForTimeout(300);
  const stockValue = await admin.locator('input[placeholder="例：20"]').inputValue();
  log("admin sees reduced stock in edit modal", stockValue === "1");
  await admin.click("text=✕");
  await admin.waitForTimeout(200);

  // admin: order history, expand row, see shipping info, mark shipped via confirm popup
  await admin.click("text=販促品注文履歴");
  await admin.waitForTimeout(300);
  body = await admin.textContent("body");
  log("admin sees pending shipment", body.includes("販促品スタッフ") && body.includes("発送待ち"));

  await admin.click("text=オリジナルタオルSサイズ");
  await admin.waitForTimeout(300);
  body = await admin.textContent("body");
  log("expanded row shows shipping address/phone", body.includes("東京都新宿区テスト1-1-1") && body.includes("090-0000-1111"));

  await admin.getByRole("button", { name: "発送済みにする" }).click();
  await admin.waitForTimeout(300);
  body = await admin.textContent("body");
  log("ship confirm popup shown", body.includes("発送済みにしますか"));

  await admin.getByRole("button", { name: "発送済みにする" }).last().click();
  await admin.waitForTimeout(600);
  body = await admin.textContent("body");
  log("no more 発送済みにする button after marking shipped", !body.includes("発送済みにする"));

  await staff.goto("http://localhost:3000/staff/points");
  await staff.click("text=交換履歴");
  body = await staff.textContent("body");
  log("staff sees order as 発送済み", body.includes("発送済み"));

  // delete via confirm popup
  await admin.goto("http://localhost:3000/company");
  await admin.click("text=販促品一覧");
  await admin.getByRole("button", { name: "編集" }).click();
  await admin.waitForTimeout(300);
  await admin.click("text=この販促品を削除する");
  await admin.waitForTimeout(300);
  body = await admin.textContent("body");
  log("delete confirm popup shown", body.includes("削除しますか"));
  await admin.getByRole("button", { name: "削除する", exact: true }).click();
  await admin.waitForTimeout(1500);
  log(
    "item removed from list after delete",
    (await admin.getByText("オリジナルタオルSサイズ").count()) === 0 ||
      !(await admin.getByText("オリジナルタオルSサイズ").first().isVisible().catch(() => false)),
  );

  console.log(process.exitCode ? "PROMO SMOKE TEST HAD FAILURES" : "PROMO SMOKE TEST PASSED");
} catch (err) {
  console.error("PROMO SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-promo-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-promo-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
