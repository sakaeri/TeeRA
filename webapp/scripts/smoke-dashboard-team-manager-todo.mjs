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

// やることリストは「/company/*に入れる全員」＝本部管理者/編集者だけでなく
// チームのマネージャー/リーダーにも共有される場所、というルールの検証:
// - チームマネージャーも「誰宛か」の候補に出る（これまでは本部管理者/編集者
//   限定で漏れていた）
// - チームマネージャー自身が開いても「誰が出したか」に自分の名前が
//   自動入力される（これまでは空欄になっていた）
// - 説明文が「会社アカウントに入れる全員」に共有される旨に変わっている

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();
const manager = await (await browser.newContext()).newPage();

const adminEmail = `dtm-admin-${Date.now()}@example.com`;
const managerEmail = `dtm-manager-${Date.now()}@example.com`;
const companyName = `やることリスト対象確認株式会社${Date.now()}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "やることリスト確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  // --- チーム作成＋マネージャーを招待 ---
  await admin.goto("http://localhost:3000/company/settings?tab=teams");
  await admin.getByRole("button", { name: "＋チームを作成" }).click();
  await admin.waitForTimeout(200);
  {
    const modal = admin.locator("div.fixed.inset-0.z-30").last();
    await modal.locator('input[placeholder="新しいチーム名"]').fill("Aチーム");
    await modal.getByRole("button", { name: "作成", exact: true }).click();
  }
  await admin.waitForTimeout(500);

  const teamACard = admin
    .locator("div.rounded-xl.border.border-border.p-4")
    .filter({ has: admin.locator("div.mb-3.font-semibold", { hasText: /^Aチーム$/ }) });
  await teamACard.getByRole("button", { name: "＋招待" }).click();
  await teamACard.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForTimeout(400);
  const managerInviteUrl = await teamACard.locator("input[readonly]").inputValue();

  await manager.goto(managerInviteUrl);
  await manager.click("text=アカウントを作成して参加する");
  await manager.fill("#name", "Aチームマネージャー");
  await manager.fill("#email", managerEmail);
  await manager.fill("#password", "password123");
  await manager.click("button[type=submit]");
  await manager.waitForURL(/\/invite\//, { timeout: 10000 });
  await manager.click("text=参加する");
  await manager.waitForURL("http://localhost:3000/staff", { timeout: 10000 });
  const managerUserId = psql(`select id from "User" where email='${managerEmail}';`);
  const managerRole = psql(
    `select cm.role from "CompanyMembership" cm where cm."companyId"='${companyId}' and cm."userId"='${managerUserId}';`,
  );
  log("チームマネージャーの会社レベルroleはSTAFFのまま", managerRole === "STAFF");

  // --- 管理者側: 説明文と、チームマネージャーが「誰宛か」候補に出ること ---
  await admin.goto("http://localhost:3000/company");
  await admin.click("text=＋やることリスト作成");
  await admin.waitForTimeout(200);
  const adminModalText = await admin.textContent("body");
  log(
    "説明文が「会社アカウントに入れる全員」に共有される旨に変わっている",
    adminModalText.includes("チームのマネージャー/リーダー") && adminModalText.includes("共有される"),
  );
  const recipientLabels = await admin.locator("select").first().locator("option").allTextContents();
  log("チームマネージャーが「誰宛か」の候補に出る", recipientLabels.includes("Aチームマネージャー"));

  await admin.fill('input[placeholder="やることを入力"]', "配属先の対応をお願いします");
  await admin.fill('input[type=date]', "2026-12-01");
  await admin.selectOption("select", { label: "Aチームマネージャー" });
  await admin.getByRole("button", { name: "作成する" }).click();
  await admin.waitForTimeout(600);

  // --- チームマネージャー側: ダッシュボードに入れて、宛先の自分のやることが見え、
  //     自分で作成すれば「誰が出したか」に自分の名前が自動入力される ---
  await manager.goto("http://localhost:3000/company");
  await manager.waitForTimeout(300);
  let managerBody = await manager.textContent("body");
  log(
    "チームマネージャー宛のやることがダッシュボードに見える",
    managerBody.includes("配属先の対応をお願いします") && managerBody.includes("Aチームマネージャー宛"),
  );

  await manager.click("text=＋やることリスト作成");
  await manager.waitForTimeout(200);
  const managerCreatedByValue = await manager.locator("input[disabled]").inputValue();
  log(
    "チームマネージャー自身が開くと「誰が出したか」に自分の名前が自動入力される（空欄にならない）",
    managerCreatedByValue === "Aチームマネージャー（自動入力）",
  );
  const managerRecipientLabels = await manager.locator("select").first().locator("option").allTextContents();
  log("チームマネージャー側からも本部管理者が「誰宛か」候補に出る", managerRecipientLabels.includes("やることリスト確認管理者"));

  console.log(process.exitCode ? "DASHBOARD TEAM MANAGER TODO SMOKE TEST HAD FAILURES" : "DASHBOARD TEAM MANAGER TODO SMOKE TEST PASSED");
} catch (err) {
  console.error("DASHBOARD TEAM MANAGER TODO SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-dtm-admin-failure.png" });
  await manager.screenshot({ path: "/tmp/smoke-dtm-manager-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
