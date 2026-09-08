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

// チーム追加課金（Tee都度払い、プラン不問）の検証:
// - 1チーム目は無料で作成できる
// - 残高不足の状態では2チーム目の「＋チームを作成」ボタンが無効化され、
//   不足メッセージが出る
// - Teeを付与すると2チーム目が作成でき、10Tee消費・履歴が記録される
// - 3チーム目も同様に10Tee消費される

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();

const adminEmail = `teamunlock-admin-${Date.now()}@example.com`;
const companyName = `チーム追加課金確認株式会社${Date.now()}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "チーム追加課金確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  let balance = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("会社登録直後の残高は0", balance === 0);

  // --- 1チーム目は無料 ---
  await admin.goto("http://localhost:3000/company/settings?tab=basic");
  await admin.getByRole("button", { name: "＋チームを作成" }).click();
  await admin.waitForTimeout(300);
  let modal = admin.locator("div.fixed.inset-0.z-30").last();
  await modal.locator('input[placeholder="新しいチーム名"]').fill("第1チーム");
  const teeNoteVisible1 = await modal.getByText(/Teeを消費します/).count();
  log("1チーム目作成時はTee消費の注記が出ない", teeNoteVisible1 === 0);
  await modal.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);

  const team1Id = psql(`select id from "Team" where "companyId"='${companyId}' and name='第1チーム';`);
  log("1チーム目が作成された", Boolean(team1Id));
  balance = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("1チーム目作成では残高が減らない（0のまま）", balance === 0);
  const team1LedgerCount = Number(
    psql(`select count(*) from "TeeLedgerEntry" where "companyId"='${companyId}' and type='CONSUME_TEAM_UNLOCK';`),
  );
  log("1チーム目作成では課金履歴が作られない", team1LedgerCount === 0);

  // --- 残高不足では2チーム目のボタンが無効化される ---
  await admin.reload();
  await admin.waitForTimeout(300);
  const createButtonDisabled = await admin.getByRole("button", { name: "＋チームを作成" }).isDisabled();
  log("残高不足時は「＋チームを作成」ボタンが無効化される", createButtonDisabled);
  let bodyText = await admin.textContent("body");
  log("残高不足のメッセージが表示される", bodyText.includes("Tee残高が不足しています"));

  // --- Teeを付与すると2チーム目が作成できる ---
  psql(
    `update "Company" set "teeBalance" = 10 where id = '${companyId}';` +
      `insert into "TeeLedgerEntry" (id, "companyId", type, amount, "balanceAfter", "createdAt") values (gen_random_uuid()::text, '${companyId}', 'ADJUSTMENT', 10, 10, now());`,
  );
  await admin.reload();
  await admin.waitForTimeout(300);
  const createButtonEnabled = await admin.getByRole("button", { name: "＋チームを作成" }).isEnabled();
  log("Tee付与後は「＋チームを作成」ボタンが有効になる", createButtonEnabled);

  await admin.getByRole("button", { name: "＋チームを作成" }).click();
  await admin.waitForTimeout(300);
  modal = admin.locator("div.fixed.inset-0.z-30").last();
  const teeNoteVisible2 = await modal.getByText("このチームの作成に10 Teeを消費します。").count();
  log("2チーム目作成時は10Tee消費の注記が出る", teeNoteVisible2 === 1);
  await modal.locator('input[placeholder="新しいチーム名"]').fill("第2チーム");
  await modal.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);

  const team2Id = psql(`select id from "Team" where "companyId"='${companyId}' and name='第2チーム';`);
  log("2チーム目が作成された", Boolean(team2Id));
  balance = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("2チーム目作成で10Tee消費される（10→0）", balance === 0);

  const team2Ledger = psql(
    `select type, amount, "teamId" from "TeeLedgerEntry" where "companyId"='${companyId}' and type='CONSUME_TEAM_UNLOCK';`,
  );
  log("課金履歴が1件記録され、金額とteamIdが正しい", team2Ledger === `CONSUME_TEAM_UNLOCK|-10|${team2Id}`);

  const balanceInvariant = Number(psql(`select sum(amount) from "TeeLedgerEntry" where "companyId"='${companyId}';`));
  log("teeBalanceが台帳合計と一致する（不変条件）", balance === balanceInvariant);

  // --- 3チーム目も同様に10Tee消費される ---
  psql(
    `update "Company" set "teeBalance" = 10 where id = '${companyId}';` +
      `insert into "TeeLedgerEntry" (id, "companyId", type, amount, "balanceAfter", "createdAt") values (gen_random_uuid()::text, '${companyId}', 'ADJUSTMENT', 10, 10, now());`,
  );
  await admin.reload();
  await admin.waitForTimeout(300);
  await admin.getByRole("button", { name: "＋チームを作成" }).click();
  await admin.waitForTimeout(300);
  modal = admin.locator("div.fixed.inset-0.z-30").last();
  await modal.locator('input[placeholder="新しいチーム名"]').fill("第3チーム");
  await modal.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);

  const team3Id = psql(`select id from "Team" where "companyId"='${companyId}' and name='第3チーム';`);
  log("3チーム目も作成できる", Boolean(team3Id));
  balance = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("3チーム目作成でも10Tee消費される", balance === 0);
  const totalUnlockCount = Number(
    psql(`select count(*) from "TeeLedgerEntry" where "companyId"='${companyId}' and type='CONSUME_TEAM_UNLOCK';`),
  );
  log("課金履歴が累計2件になる（2・3チーム目分）", totalUnlockCount === 2);

  // --- Tee残高ページにも履歴ラベルが表示される ---
  await admin.goto("http://localhost:3000/company/wallet");
  await admin.click("text=購入履歴・利用履歴");
  bodyText = await admin.textContent("body");
  log("Tee残高の履歴に「追加チーム作成」ラベルが表示される", bodyText.includes("追加チーム作成"));

  console.log(process.exitCode ? "TEAM UNLOCK SMOKE TEST HAD FAILURES" : "TEAM UNLOCK SMOKE TEST PASSED");
} catch (err) {
  console.error("TEAM UNLOCK SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
