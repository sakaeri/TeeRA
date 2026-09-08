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
const adminACtx = await browser.newContext();
const adminA = await adminACtx.newPage();
const staffXCtx = await browser.newContext();
const staffX = await staffXCtx.newPage();
const staffX2Ctx = await browser.newContext();
const staffX2 = await staffX2Ctx.newPage();
const adminBCtx = await browser.newContext();
const adminB = await adminBCtx.newPage();
const staffZCtx = await browser.newContext();
const staffZ = await staffZCtx.newPage();

const adminAEmail = `teerefund-adminA-${Date.now()}@example.com`;
const staffXEmail = `teerefund-staffX-${Date.now()}@example.com`;
const staffX2Email = `teerefund-staffX2-${Date.now()}@example.com`;
const adminBEmail = `teerefund-adminB-${Date.now()}@example.com`;
const staffZEmail = `teerefund-staffZ-${Date.now()}@example.com`;

try {
  // Company A（募集する会社）
  await adminA.goto("http://localhost:3000/register");
  await adminA.fill("#name", "募集A管理者");
  await adminA.fill("#email", adminAEmail);
  await adminA.fill("#password", "password123");
  await adminA.click("button[type=submit]");
  await adminA.waitForURL("http://localhost:3000/register/company");
  await adminA.fill("#name", "Tee返金テストA社");
  await adminA.click("button[type=submit]");
  await adminA.waitForURL("http://localhost:3000/company");

  const companyAId = psql(`select id from "Company" where name='Tee返金テストA社' order by "createdAt" desc limit 1;`);
  psql(
    `update "Company" set "teeBalance" = 100 where id = '${companyAId}';` +
      `insert into "TeeLedgerEntry" (id, "companyId", type, amount, "balanceAfter", "createdAt") values (gen_random_uuid()::text, '${companyAId}', 'ADJUSTMENT', 100, 100, now());`,
  );

  // Staff X = A社自身のスタッフ（既につながりがある）
  await adminA.click("text=スタッフ名簿");
  await adminA.click("text=＋スタッフを追加する");
  await adminA.click("text=本アカウントを招待");
  await adminA.getByRole("button", { name: "招待URLを発行する" }).click();
  await adminA.waitForSelector('input[readonly]');
  const inviteUrlX = await adminA.locator('input[readonly]').inputValue();
  await adminA.getByRole("button", { name: "✕" }).click();

  await staffX.goto(inviteUrlX);
  await staffX.click("text=アカウントを作成して参加する");
  await staffX.fill("#name", "登録済みスタッフX");
  await staffX.fill("#email", staffXEmail);
  await staffX.fill("#password", "password123");
  await staffX.click("button[type=submit]");
  await staffX.waitForURL(new RegExp("/invite/"));
  await staffX.click("text=参加する");
  await staffX.waitForURL("http://localhost:3000/staff");

  // Staff X2 = A社自身の別スタッフ（管理者アサインの検証用 — Xは後で同日の
  // 別募集にも応募させるため、同日重複扱いを避けるために別人にする）
  await adminA.click("text=スタッフ名簿");
  await adminA.click("text=＋スタッフを追加する");
  await adminA.click("text=本アカウントを招待");
  await adminA.getByRole("button", { name: "招待URLを発行する" }).click();
  await adminA.waitForSelector('input[readonly]');
  const inviteUrlX2 = await adminA.locator('input[readonly]').inputValue();
  await adminA.getByRole("button", { name: "✕" }).click();

  await staffX2.goto(inviteUrlX2);
  await staffX2.click("text=アカウントを作成して参加する");
  await staffX2.fill("#name", "登録済みスタッフX2");
  await staffX2.fill("#email", staffX2Email);
  await staffX2.fill("#password", "password123");
  await staffX2.click("button[type=submit]");
  await staffX2.waitForURL(new RegExp("/invite/"));
  await staffX2.click("text=参加する");
  await staffX2.waitForURL("http://localhost:3000/staff");

  // Company B（A社とは無関係の別会社）+ Staff Z（A社と一切つながりが無い）
  await adminB.goto("http://localhost:3000/register");
  await adminB.fill("#name", "無関係B管理者");
  await adminB.fill("#email", adminBEmail);
  await adminB.fill("#password", "password123");
  await adminB.click("button[type=submit]");
  await adminB.waitForURL("http://localhost:3000/register/company");
  await adminB.fill("#name", "Tee返金テストB社（無関係）");
  await adminB.click("button[type=submit]");
  await adminB.waitForURL("http://localhost:3000/company");

  await adminB.click("text=スタッフ名簿");
  await adminB.click("text=＋スタッフを追加する");
  await adminB.click("text=本アカウントを招待");
  await adminB.getByRole("button", { name: "招待URLを発行する" }).click();
  await adminB.waitForSelector('input[readonly]');
  const inviteUrlZ = await adminB.locator('input[readonly]').inputValue();

  await staffZ.goto(inviteUrlZ);
  await staffZ.click("text=アカウントを作成して参加する");
  await staffZ.fill("#name", "無関係スタッフZ");
  await staffZ.fill("#email", staffZEmail);
  await staffZ.fill("#password", "password123");
  await staffZ.click("button[type=submit]");
  await staffZ.waitForURL(new RegExp("/invite/"));
  await staffZ.click("text=参加する");
  await staffZ.waitForURL("http://localhost:3000/staff");

  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const today = new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10);

  // A社: オーダーを作成→公開募集に切り替え（人数2、誰も埋まっていないので20Teeロック）
  await adminA.goto("http://localhost:3000/company/calendar");
  await adminA.locator("button", { hasText: "＋" }).last().click();
  await adminA.getByText("募集を作成").click();
  await adminA.waitForSelector("text=募集を作成");
  const recruitmentTitle = `Tee返金テスト募集${Date.now()}`;
  await adminA.locator('input[type="text"]').first().fill(recruitmentTitle);
  await adminA.locator("label:has-text('募集人数') input").first().fill("2");
  await adminA.getByRole("button", { name: "掲載する" }).click();
  await adminA.waitForTimeout(300);
  await adminA.getByRole("button", { name: /件の募集を作成/ }).click();
  await adminA.waitForTimeout(800);

  await adminA.goto(`http://localhost:3000/company/calendar?date=${today}`);
  await adminA.waitForTimeout(600);
  await adminA
    .locator(".fixed.inset-0.z-20")
    .first()
    .getByRole("button", { name: /^募集一覧/ })
    .click();
  await adminA.waitForTimeout(300);
  await adminA.locator(".fixed.inset-0.z-20").first().getByRole("button", { name: "編集" }).click();
  await adminA.waitForTimeout(300);
  const editModal = adminA.locator(".fixed.inset-0.z-20").nth(1);
  await editModal.getByRole("button", { name: "公開募集に切り替える" }).click();
  await editModal.locator('input[type="number"]').last().fill("1200");
  const confirmBoxes = editModal.locator('input[type="checkbox"]');
  await confirmBoxes.nth(0).check();
  await confirmBoxes.nth(1).check();
  await confirmBoxes.nth(2).check();
  await editModal.getByRole("button", { name: "公開募集を開始する" }).click();
  await adminA.waitForTimeout(700);

  let state = psql(`select "lockedTee" from "PublicRecruitment" where "companyId"='${companyAId}' and title='${recruitmentTitle}';`);
  log("公開募集に切り替えると2枠×10Teeがロックされる", state === "20");
  let balance = Number(psql(`select "teeBalance" from "Company" where id='${companyAId}';`));
  log("残高が80になる（100-20）", balance === 80);

  const recruitmentId = psql(`select id from "PublicRecruitment" where "companyId"='${companyAId}' and title='${recruitmentTitle}';`);

  // 無関係スタッフZが応募 → Teeは消費されたまま（ロック解除されない）
  await staffZ.goto("http://localhost:3000/staff/recruitments");
  const zItem = staffZ.locator("li", { hasText: recruitmentTitle });
  await zItem.getByRole("button", { name: "応募する" }).click();
  await staffZ.waitForTimeout(800);

  state = psql(`select "lockedTee" from "PublicRecruitment" where id='${recruitmentId}';`);
  log("無関係スタッフの応募ではTeeは戻らない（ロック20のまま）", state === "20");
  balance = Number(psql(`select "teeBalance" from "Company" where id='${companyAId}';`));
  log("無関係スタッフの応募では残高は変わらない（80のまま）", balance === 80);

  // A社自身のスタッフXが残り1枠に応募 → その場でその1枠分(10Tee)が即返金される
  await staffX.goto("http://localhost:3000/staff/recruitments");
  const xItem = staffX.locator("li", { hasText: recruitmentTitle });
  await xItem.getByRole("button", { name: "応募する" }).click();
  await staffX.waitForTimeout(800);

  state = psql(`select "lockedTee" from "PublicRecruitment" where id='${recruitmentId}';`);
  log("自社スタッフの応募では即座に1枠分(10Tee)返金される（ロック10に減る）", state === "10");
  balance = Number(psql(`select "teeBalance" from "Company" where id='${companyAId}';`));
  log("自社スタッフの応募で残高が10戻る（80→90）", balance === 90);

  const refundEventCount = Number(
    psql(
      `select count(*) from "TeeLedgerEntry" where "publicRecruitmentId"='${recruitmentId}' and type='UNLOCK_REFUND_RECRUITMENT';`,
    ),
  );
  log("返金の履歴が1件記録される", refundEventCount === 1);

  // 管理者による直接アサイン（＋スタッフを追加）でも、既に自社所属の
  // スタッフなら同様にその場で返金される
  await adminA.locator("button", { hasText: "＋" }).last().click();
  await adminA.getByText("募集を作成").click();
  await adminA.waitForSelector("text=募集を作成");
  const recruitmentTitle2 = `Tee返金テスト_アサイン${Date.now()}`;
  await adminA.locator('input[type="text"]').first().fill(recruitmentTitle2);
  await adminA.locator("label:has-text('募集人数') input").first().fill("1");
  await adminA.getByRole("button", { name: "掲載する" }).click();
  await adminA.waitForTimeout(300);
  await adminA.getByRole("button", { name: /件の募集を作成/ }).click();
  await adminA.waitForTimeout(800);

  await adminA.goto(`http://localhost:3000/company/calendar?date=${today}`);
  await adminA.waitForTimeout(600);
  await adminA
    .locator(".fixed.inset-0.z-20")
    .first()
    .getByRole("button", { name: /^募集一覧/ })
    .click();
  await adminA.waitForTimeout(300);
  const recruitment2Row = adminA.locator("li", { hasText: recruitmentTitle2 });
  await recruitment2Row.getByRole("button", { name: "編集" }).click();
  await adminA.waitForTimeout(300);
  const editModal2 = adminA.locator(".fixed.inset-0.z-20").nth(1);
  await editModal2.getByRole("button", { name: "公開募集に切り替える" }).click();
  await editModal2.locator('input[type="number"]').last().fill("1200");
  const confirmBoxes2 = editModal2.locator('input[type="checkbox"]');
  await confirmBoxes2.nth(0).check();
  await confirmBoxes2.nth(1).check();
  await confirmBoxes2.nth(2).check();
  await editModal2.getByRole("button", { name: "公開募集を開始する" }).click();
  await adminA.waitForTimeout(700);

  const recruitment2Id = psql(`select id from "PublicRecruitment" where "companyId"='${companyAId}' and title='${recruitmentTitle2}';`);
  let state2 = psql(`select "lockedTee" from "PublicRecruitment" where id='${recruitment2Id}';`);
  log("2つ目の募集も公開募集切替で1枠(10Tee)がロックされる", state2 === "10");

  await adminA.goto(`http://localhost:3000/company/calendar?date=${today}`);
  await adminA.waitForTimeout(600);
  await adminA
    .locator(".fixed.inset-0.z-20")
    .first()
    .getByRole("button", { name: /^募集一覧/ })
    .click();
  await adminA.waitForTimeout(300);
  const recruitment2RowAgain = adminA.locator("li", { hasText: recruitmentTitle2 });
  await recruitment2RowAgain.getByRole("button", { name: "＋ スタッフを追加" }).click();
  await adminA.waitForTimeout(300);
  const assignModal = adminA.locator(".fixed.inset-0.z-20").nth(1);
  await assignModal.locator("label", { hasText: "登録済みスタッフX2" }).locator('input[type=checkbox]').check();
  await assignModal.getByRole("button", { name: /名をアサインする/ }).click();
  await adminA.waitForTimeout(800);

  state2 = psql(`select "lockedTee" from "PublicRecruitment" where id='${recruitment2Id}';`);
  log("管理者が自社スタッフを直接アサインしても即座に返金される（ロック0に）", state2 === "0");

  // ② 日付が過ぎた公開募集でも、未使用分の人数上限を減らして返金できる
  // （UIから直接は過去日の公開募集を作れないため、SQLで直接その状態を再現する）
  // 日付はJST基準で計算してから渡す — Postgres側のcurrent_dateはUTC基準
  // （このDBのTIMEZONE設定はEtc/UTC）なので、JST 0時〜9時台はcurrent_date
  // が「JSTの前日」を指してしまい、テストが期待する日付とずれる。
  const yesterday = new Date(Date.now() + JST_OFFSET_MS - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const pastRecruitmentId = psql(
    `with ins as (insert into "PublicRecruitment" (id, "companyId", title, date, "maxEntries", "perEntryTeeCost", "lockedTee", status, visibility, "publishedAt", "publicOpenedAt", "isUndecided", "extraItems", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyAId}', '過去の公開募集テスト', '${yesterday}'::date, 2, 10, 20, 'PUBLISHED', 'PUBLIC', now(), now(), true, '[]'::jsonb, now(), now()) returning id) select id from ins;`,
  );
  psql(
    `update "Company" set "teeBalance" = "teeBalance" - 20 where id = '${companyAId}';` +
      `insert into "TeeLedgerEntry" (id, "companyId", type, amount, "balanceAfter", "publicRecruitmentId", "createdAt") values (gen_random_uuid()::text, '${companyAId}', 'LOCK_RECRUITMENT', -20, (select "teeBalance" from "Company" where id='${companyAId}'), '${pastRecruitmentId}', now());`,
  );
  const balanceBeforePastFix = Number(psql(`select "teeBalance" from "Company" where id='${companyAId}';`));
  await adminA.goto(`http://localhost:3000/company/calendar?date=${yesterday}`);
  await adminA.waitForTimeout(600);
  await adminA
    .locator(".fixed.inset-0.z-20")
    .first()
    .getByRole("button", { name: /^募集一覧/ })
    .click();
  await adminA.waitForTimeout(300);
  await adminA.locator(".fixed.inset-0.z-20").first().getByRole("button", { name: "編集" }).click();
  await adminA.waitForTimeout(300);
  const pastEditModal = adminA.locator(".fixed.inset-0.z-20").nth(1);
  const pastBody = await pastEditModal.innerText();
  log("過去日の公開募集にも編集ポップアップが開く", pastBody.includes("募集人数の上限"));

  const maxEntriesInput = pastEditModal.locator('input[type=number]').first();
  log("人数上限の入力欄は無効化されていない（減らす操作はできる）", await maxEntriesInput.isEnabled());
  const maxAttr = await maxEntriesInput.getAttribute("max");
  log("過去日は現在の人数上限より増やせないようmax属性が付く", maxAttr === "2");

  await maxEntriesInput.fill("0");
  await pastEditModal.getByRole("button", { name: "変更する" }).click();
  await adminA.waitForTimeout(600);

  const pastLockedAfter = psql(`select "lockedTee", "maxEntries" from "PublicRecruitment" where id='${pastRecruitmentId}';`);
  log("過去日の募集でも人数上限を0に減らすと全額返金される", pastLockedAfter === "0|0");
  const balanceAfterPastFix = Number(psql(`select "teeBalance" from "Company" where id='${companyAId}';`));
  log("過去日の返金で残高が20戻る", balanceAfterPastFix === balanceBeforePastFix + 20);

  console.log(process.exitCode ? "RECRUITMENT TEE REFUND SMOKE TEST HAD FAILURES" : "RECRUITMENT TEE REFUND SMOKE TEST PASSED");
} catch (err) {
  console.error("RECRUITMENT TEE REFUND SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
