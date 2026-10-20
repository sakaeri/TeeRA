// 依頼主がオーダーを取り消した時、派遣元が依頼主×業務内容ごとに設定した
// キャンセル規定（キャンセル不可／締切後キャンセル料）が守られることを確認する。
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

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
const clientCtx = await browser.newContext();
const client = await clientCtx.newPage();
const agencyCtx = await browser.newContext();
const agency = await agencyCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const clientEmail = `ccr-client-${Date.now()}@example.com`;
const agencyEmail = `ccr-agency-${Date.now()}@example.com`;
const staffEmail = `ccr-staff-${Date.now()}@example.com`;

try {
  // --- client company: register ---
  await client.goto("http://localhost:3000/register");
  await client.fill("#name", "依頼主担当者");
  await client.fill("#email", clientEmail);
  await client.click("button[type=submit]");
  await client.waitForTimeout(400);
  await client.goto(extractMagicLinkFromLog());
  await client.waitForURL("http://localhost:3000/register/company");
  await client.fill("#name", "取消依頼主株式会社");
  await client.click("button[type=submit]");
  await client.waitForURL("http://localhost:3000/company");
  const clientCompanyId = psql(`select id from "Company" where name='取消依頼主株式会社' order by "createdAt" desc limit 1;`);

  // --- agency company: register ---
  await agency.goto("http://localhost:3000/register");
  await agency.fill("#name", "派遣元担当者");
  await agency.fill("#email", agencyEmail);
  await agency.click("button[type=submit]");
  await agency.waitForTimeout(400);
  await agency.goto(extractMagicLinkFromLog());
  await agency.waitForURL("http://localhost:3000/register/company");
  await agency.fill("#name", "取消派遣元株式会社");
  await agency.click("button[type=submit]");
  await agency.waitForURL("http://localhost:3000/company");
  const agencyCompanyId = psql(`select id from "Company" where name='取消派遣元株式会社' order by "createdAt" desc limit 1;`);
  psql(`update "Company" set "notificationEmail"='cancel-notify-${Date.now()}@example.com' where id='${agencyCompanyId}';`);

  // --- real (non-proxy) relationship: agencyCompanyId sends staff to clientCompanyId ---
  psql(`update "Company" set "agencyEnabled" = true where id = '${agencyCompanyId}';`);
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "clientCompanyId", status, "createdAt") ` +
      `values (gen_random_uuid()::text, '${agencyCompanyId}', '${agencyCompanyId}', '${clientCompanyId}', 'ACTIVE', now()) returning id) select id from ins;`,
  );
  log("real CompanyRelationship created between the two companies", Boolean(relId));

  // --- agency: invite + register staff ---
  await agency.goto("http://localhost:3000/company/roster");
  await agency.click("text=＋スタッフを追加");
  await agency.click("text=本アカウントを招待");
  await agency.getByRole("button", { name: "招待URLを発行する" }).click();
  await agency.waitForSelector('input[readonly]');
  const inviteUrl = await agency.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "派遣スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // --- client: post an order (自社・配属スタッフ向けの募集) ---
  await client.goto("http://localhost:3000/company/calendar");
  await client.locator("button", { hasText: "＋" }).last().click();
  await client.getByText("募集を作成").click();
  let modal = client.locator("div.fixed.inset-0.z-20").last();
  await modal.locator('input[placeholder="例：倉庫での軽作業"]').fill("取消テスト業務");
  await modal.getByRole("button", { name: "掲載する" }).click();
  await client.waitForTimeout(300);
  await modal.getByRole("button", { name: /件の募集を作成/ }).click();
  await client.waitForTimeout(600);

  const recruitmentId = psql(
    `select id from "PublicRecruitment" where "companyId"='${clientCompanyId}' order by "createdAt" desc limit 1;`,
  );
  log("client's recruitment created", Boolean(recruitmentId));

  // --- agency: assign its staff to the client's order ---
  const recruitmentDate = psql(`select to_char(date, 'DD') from "PublicRecruitment" where id='${recruitmentId}';`);
  await agency.goto("http://localhost:3000/company/calendar");
  await agency.waitForTimeout(300);
  await agency.locator(`button:has-text("${Number(recruitmentDate)}")`).first().click();
  await agency.waitForTimeout(300);
  const dayModal = agency.locator("div.fixed.inset-0.z-20").last();
  await dayModal.getByRole("button", { name: "オーダー", exact: true }).click();
  await agency.waitForTimeout(300);
  await dayModal.getByRole("combobox").selectOption({ label: "派遣スタッフ" });
  await dayModal.getByRole("button", { name: "アサイン" }).click();
  await agency.waitForTimeout(200);
  await dayModal.getByRole("button", { name: "確定" }).click();
  await agency.waitForTimeout(600);
  const shiftId = psql(`select id from "Shift" where "staffUserId"='${staffUserId}' order by "createdAt" desc limit 1;`);
  log("派遣元のスタッフが依頼主のオーダーに入る", Boolean(shiftId));

  // --- agency: 依頼主詳細＞単価＞キャンセル規定で、共通の規定を「キャンセル不可」に ---
  await agency.goto("http://localhost:3000/company/roster");
  await agency.click("text=依頼主一覧");
  await agency.waitForTimeout(200);
  await agency.click("text=取消依頼主株式会社");
  await agency.waitForTimeout(300);
  const clientPanel = agency.locator("div.fixed.inset-0.z-30").last();
  await clientPanel.getByRole("button", { name: "単価", exact: true }).click();
  await agency.waitForTimeout(300);
  log("未設定の注意はキャンセル規定の欄に1回だけ出る", ((await clientPanel.innerText()).match(/未設定（キャンセル自由として扱います）/g) ?? []).length === 1);
  log("業務内容ごとの「キャンセル規定」ボタンは無い", (await clientPanel.getByRole("button", { name: "キャンセル規定", exact: true }).count()) === 0);
  await clientPanel.getByRole("button", { name: "共通の規定を設定" }).click();
  let ruleModal = agency.locator("div.fixed.inset-0.z-40").last();
  await ruleModal.locator("select").first().selectOption("NOT_ALLOWED");
  await ruleModal.getByRole("button", { name: "保存" }).click();
  await agency.waitForTimeout(600);
  log(
    "単価タブから依頼主共通のキャンセル規定（キャンセル不可）を保存できる",
    psql(`select "cancelPolicy" from "ClientCancelRule" where "companyRelationshipId"='${relId}';`) === "NOT_ALLOWED",
  );
  log("単価タブに共通のキャンセル規定が表示される", (await clientPanel.textContent()).includes("全業務共通：キャンセル不可"));

  // --- client: try to delete the order -> blocked ---
  async function openDeleteConfirm() {
    await client.goto(`http://localhost:3000/company/calendar?date=${psql(`select to_char(date, 'YYYY-MM-DD') from "PublicRecruitment" where id='${recruitmentId}';`)}`);
    await client.waitForTimeout(600);
    await client.getByText("募集一覧").first().click();
    await client.waitForTimeout(300);
    await client.getByText("編集").first().click();
    await client.waitForTimeout(400);
    await client.getByRole("button", { name: "この募集を削除する" }).click();
    await client.waitForTimeout(800);
    return client.locator("div.fixed.inset-0").last();
  }
  let confirm = await openDeleteConfirm();
  let confirmText = await confirm.textContent();
  log("キャンセル不可の場合、取り消せない旨と対象スタッフが表示される", confirmText.includes("取り消せません") && confirmText.includes("派遣スタッフ"));
  log("キャンセル不可の場合、削除ボタンが押せない", await confirm.getByRole("button", { name: "削除する" }).isDisabled());

  // --- agency: この業務内容だけ「締切後はキャンセル料」の例外にする(締切は30日前＝もう過ぎている) ---
  await agency.goto("http://localhost:3000/company/roster");
  await agency.click("text=依頼主一覧");
  await agency.waitForTimeout(200);
  await agency.click("text=取消依頼主株式会社");
  await agency.waitForTimeout(300);
  await clientPanel.getByRole("button", { name: "単価", exact: true }).click();
  await agency.waitForTimeout(300);
  await clientPanel.getByLabel("業務内容ごとに変える").selectOption({ label: "取消テスト業務" });
  ruleModal = agency.locator("div.fixed.inset-0.z-40").last();
  log("例外の画面は共通の規定を初期値にして開く", (await ruleModal.locator("select").first().inputValue()) === "NOT_ALLOWED");
  await ruleModal.locator("select").first().selectOption("FEE_AFTER_DEADLINE");
  await ruleModal.locator('input[type="number"]').first().fill("30");
  await ruleModal.locator('input[type="time"]').fill("00:00");
  await ruleModal.locator('input[type="number"]').last().fill("5000");
  if (process.env.HOWTO_SCREENSHOT) {
    await agency.setViewportSize({ width: 1280, height: 900 });
    await agency.waitForTimeout(300);
    await agency.screenshot({ path: process.env.HOWTO_SCREENSHOT });
  }
  await ruleModal.getByRole("button", { name: "保存" }).click();
  await agency.waitForTimeout(600);
  log(
    "業務内容ごとの例外として保存される",
    psql(`select "cancelRuleOverride" || '|' || "cancelPolicy" || '|' || "cancelFeeAmount" from "CompanyPlacementRate" where "companyRelationshipId"='${relId}' and "taskName"='取消テスト業務';`) ===
      "true|FEE_AFTER_DEADLINE|5000",
  );
  log("例外がキャンセル規定の欄に業務内容名つきで出る", (await clientPanel.textContent()).includes("取消テスト業務：30日前00:00以降はキャンセル料5000円/人"));
  confirm = await openDeleteConfirm();
  confirmText = await confirm.textContent();
  log("締切後はキャンセル料の合計が表示される", confirmText.includes("キャンセル料 合計5,000円"));
  const deleteBtn = confirm.getByRole("button", { name: "削除する" });
  log("了承のチェックを入れるまで削除できない", await deleteBtn.isDisabled());
  await confirm.getByLabel("キャンセル料がかかることを了承して取り消す").check();
  await deleteBtn.click();
  await client.waitForTimeout(1000);

  log("オーダーが削除される", psql(`select status from "PublicRecruitment" where id='${recruitmentId}';`) === "DELETED");
  log("派遣スタッフのシフトは休みにせず「調整中」になる（既定の扱い）", psql(`select status from "Shift" where id='${shiftId}';`) === "ON_HOLD");
  log("キャンセル料5000円が記録される", psql(`select "feeAmount" from "ShiftCancellation" where "shiftId"='${shiftId}';`) === "5000");

  const notifyLog = execSync("tail -c 400000 /tmp/nextdev.log").toString();
  log("派遣元の通知先へ取り消しのメールが送られる", notifyLog.includes("依頼主がシフトを取り消しました"));
  log("メールに調整中である旨が書かれる", notifyLog.includes("調整中：振り替えるか休みにするかを決めてください"));

  const heldDate = psql(`select to_char(date, 'YYYY-MM-DD') from "Shift" where id='${shiftId}';`);
  await staff.goto("http://localhost:3000/staff");
  await staff.waitForTimeout(800);
  log("スタッフのカレンダーに「調整中」と表示される", (await staff.innerText("body")).includes("調整中"));

  await agency.goto("http://localhost:3000/company");
  await agency.waitForTimeout(800);
  log("派遣元のダッシュボードの「やること」に調整中が出る", (await agency.innerText("body")).includes("取り消しで調整中です"));

  // --- 派遣元が同じ日に別のシフトへ入れる（振り替え）と、調整中のシフトは自動で外れる ---
  // 社内シフト作成の画面から、調整中と同じ日（今日）に入れる
  await agency.goto("http://localhost:3000/company/calendar");
  await agency.locator("button", { hasText: "＋" }).last().click();
  await agency.getByText("シフトを作成").click();
  const assignModal = agency.locator("div.fixed.inset-0.z-20").last();
  await assignModal.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await assignModal.getByRole("button", { name: "＋ 新しい業務内容を追加する" }).click();
  await assignModal.locator('input[placeholder*="業務内容"]').fill("振替業務");
  await assignModal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await agency.waitForTimeout(300);
  await assignModal.getByRole("button", { name: "派遣スタッフ" }).click();
  await assignModal.getByRole("button", { name: "次へ" }).click();
  await agency.waitForTimeout(300);
  await assignModal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await agency.waitForTimeout(800);
  const reassignedDate = psql(`select to_char(date, 'YYYY-MM-DD') from "Shift" where "staffUserId"='${staffUserId}' and source='INHOUSE' order by "createdAt" desc limit 1;`);
  log("振り替え先のシフトが調整中と同じ日に作られる", reassignedDate === heldDate);
  log("同じ日に別のシフトへ入れると、調整中のシフトは取り消しになる", psql(`select status from "Shift" where id='${shiftId}';`) === "CANCELLED");
  log("振り替え後もキャンセル料の記録は残る", psql(`select "feeAmount" from "ShiftCancellation" where "shiftId"='${shiftId}';`) === "5000");

  // --- 電話で取り消しを受けた場合：自社の管理者が「依頼主都合」で解除して記録する ---
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const tomorrow = new Date(Date.now() + JST_OFFSET_MS + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const phoneShiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${agencyCompanyId}', '${staffUserId}', 'CLIENT', '${relId}', '取消テスト業務', '${tomorrow}', '08:00', '16:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  await agency.goto(`http://localhost:3000/company/calendar?date=${tomorrow}`);
  await agency.waitForTimeout(800);
  await agency.getByRole("button", { name: "シフトを解除" }).first().click();
  await agency.waitForTimeout(800);
  let cancelModal = agency.locator("div.fixed.inset-0").last();
  const confirmBtn = cancelModal.getByRole("button", { name: /解除する|調整中にする/ });
  log("依頼主の現場のシフトは、理由を選ぶまで解除できない", await confirmBtn.isDisabled());
  await cancelModal.getByLabel("依頼主都合（電話などで取り消しを受けた）").check();
  log("規定からキャンセル料が自動で入る", (await cancelModal.locator('input[type="number"]').inputValue()) === "5000");
  await cancelModal.getByRole("button", { name: "調整中にする" }).click();
  await agency.waitForTimeout(800);
  log(
    "電話の取り消しもキャンセル料5000円として記録される",
    psql(`select source || '|' || "feeAmount" from "ShiftCancellation" where "shiftId"='${phoneShiftId}';`) === "CLIENT_REPORTED|5000",
  );
  log("「調整中にする」を選ぶと調整中になる", psql(`select status from "Shift" where id='${phoneShiftId}';`) === "ON_HOLD");

  // --- 調整中のシフトを「休みにする」 ---
  await agency.goto(`http://localhost:3000/company/calendar?date=${tomorrow}`);
  await agency.waitForTimeout(800);
  await agency.getByRole("button", { name: "シフトを解除" }).first().click();
  await agency.waitForTimeout(800);
  cancelModal = agency.locator("div.fixed.inset-0").last();
  await cancelModal.getByRole("button", { name: "休みにする" }).click();
  await agency.waitForTimeout(800);
  log("調整中のシフトを休みにできる", psql(`select status from "Shift" where id='${phoneShiftId}';`) === "CANCELLED");

  // --- 変更履歴に勤務先・取り消しの理由・キャンセル料が出る ---
  // 自社都合の解除も1件作っておく（社内シフトは理由を選ばずに解除できる）
  const ownShiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${agencyCompanyId}', '${staffUserId}', 'INHOUSE', '自社都合テスト', '${tomorrow}', '17:00', '20:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  await agency.goto(`http://localhost:3000/company/calendar?date=${tomorrow}`);
  await agency.waitForTimeout(800);
  await agency.getByRole("button", { name: "シフトを解除" }).first().click();
  await agency.waitForTimeout(800);
  cancelModal = agency.locator("div.fixed.inset-0").last();
  await cancelModal.getByRole("button", { name: "解除する" }).click();
  await agency.waitForTimeout(800);
  log(
    "自社都合の解除はキャンセル料0の自社都合として記録される",
    psql(`select source || '|' || "feeAmount" from "ShiftCancellation" where "shiftId"='${ownShiftId}';`) === "AGENCY_OWN|0",
  );

  await agency.goto(`http://localhost:3000/company/calendar?date=${tomorrow}`);
  await agency.waitForTimeout(800);
  const historyModal = agency.locator("div.fixed.inset-0.z-20").last();
  await historyModal.getByRole("button", { name: /変更履歴/ }).click();
  await agency.waitForTimeout(300);
  const historyText = await historyModal.locator("ul").last().innerText();
  log(
    "変更履歴に依頼主名・理由・キャンセル料が出る",
    historyText.includes("取消依頼主株式会社・取消テスト業務") && historyText.includes("依頼主取消（電話等）・キャンセル料 5,000円"),
  );
  log(
    "変更履歴の自社都合の行は「自社」「自社都合」と出る",
    historyText.includes("自社・自社都合テスト") && historyText.split("\n").some((l) => l.trim() === "自社都合"),
  );
  log("取り消しの行には時間を出さない", !historyText.includes("08:00〜16:00") && !historyText.includes("17:00〜20:00"));
  await historyModal.getByRole("button", { name: "✕", exact: true }).click().catch(() => {});

  // 調整中も変更履歴に出る
  const heldShiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${agencyCompanyId}', '${staffUserId}', 'CLIENT', '${relId}', '調整中テスト', '${tomorrow}', '21:00', '22:00', false, false, 'ON_HOLD', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(`insert into "ShiftCancellation" (id, "shiftId", "cancelledByCompanyId", source, "feeAmount") values (gen_random_uuid()::text, '${heldShiftId}', '${clientCompanyId}', 'CLIENT_APP', 0);`);
  await agency.goto(`http://localhost:3000/company/calendar?date=${tomorrow}`);
  await agency.waitForTimeout(800);
  const heldModal = agency.locator("div.fixed.inset-0.z-20").last();
  await heldModal.getByRole("button", { name: /変更履歴/ }).click();
  await agency.waitForTimeout(300);
  const heldHistory = await heldModal.locator("ul").last().innerText();
  log("調整中のシフトも変更履歴に「調整中」で出る", heldHistory.includes("調整中テスト → 調整中") && heldHistory.includes("依頼主取消（アプリ）"));

  // --- agency invoice for that month contains the キャンセル料 line ---
  const month = psql(`select to_char(date, 'YYYY-MM') from "Shift" where id='${shiftId}';`);
  await agency.goto(`http://localhost:3000/company/invoices?month=${month}&client=${relId}`);
  await agency.waitForTimeout(800);
  const feeLine = psql(
    `select il.amount || '|' || il.description from "InvoiceLine" il join "Invoice" i on i.id=il."invoiceId" where i."companyRelationshipId"='${relId}' and il."shiftId"='${shiftId}';`,
  );
  log("その月の請求書にキャンセル料の明細(5000円)が載る", feeLine.startsWith("5000|") && feeLine.includes("キャンセル料"));
  const phoneMonth = psql(`select to_char(date, 'YYYY-MM') from "Shift" where id='${phoneShiftId}';`);
  await agency.goto(`http://localhost:3000/company/invoices?month=${phoneMonth}&client=${relId}`);
  await agency.waitForTimeout(800);
  log(
    "電話で受けた取り消しのキャンセル料も請求書に載る",
    psql(`select il.amount from "InvoiceLine" il join "Invoice" i on i.id=il."invoiceId" where i."companyRelationshipId"='${relId}' and il."shiftId"='${phoneShiftId}';`) === "5000",
  );

  // --- 例外を「共通に戻す」 ---
  await agency.goto("http://localhost:3000/company/roster");
  await agency.click("text=依頼主一覧");
  await agency.waitForTimeout(200);
  await agency.click("text=取消依頼主株式会社");
  await agency.waitForTimeout(300);
  await clientPanel.getByRole("button", { name: "単価", exact: true }).click();
  await agency.waitForTimeout(300);
  await clientPanel.getByRole("button", { name: "共通に戻す" }).click();
  await agency.waitForTimeout(600);
  log(
    "「共通に戻す」で例外が外れる",
    psql(`select "cancelRuleOverride" from "CompanyPlacementRate" where "companyRelationshipId"='${relId}' and "taskName"='取消テスト業務';`) === "f",
  );

  console.log(process.exitCode ? "CLIENT CANCEL POLICY SMOKE TEST HAD FAILURES" : "CLIENT CANCEL POLICY SMOKE TEST PASSED");
} catch (err) {
  console.error("CLIENT CANCEL POLICY SMOKE TEST FAILED", err);
  await client.screenshot({ path: "/tmp/smoke-cancel-policy-client-failure.png" });
  await agency.screenshot({ path: "/tmp/smoke-cancel-policy-agency-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
