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

  // --- agency: set キャンセル不可 from 依頼主詳細＞単価＞キャンセル規定 ---
  await agency.goto("http://localhost:3000/company/roster");
  await agency.click("text=依頼主一覧");
  await agency.waitForTimeout(200);
  await agency.click("text=取消依頼主株式会社");
  await agency.waitForTimeout(300);
  const clientPanel = agency.locator("div.fixed.inset-0.z-30").last();
  await clientPanel.getByRole("button", { name: "単価", exact: true }).click();
  await clientPanel.getByRole("button", { name: "キャンセル規定" }).click();
  const ruleModal = agency.locator("div.fixed.inset-0.z-40").last();
  await ruleModal.locator("select").selectOption("NOT_ALLOWED");
  await ruleModal.getByRole("button", { name: "保存" }).click();
  await agency.waitForTimeout(600);
  log(
    "単価タブからキャンセル規定（キャンセル不可）を保存できる",
    psql(`select "cancelPolicy" from "CompanyPlacementRate" where "companyRelationshipId"='${relId}' and "taskName"='取消テスト業務';`) === "NOT_ALLOWED",
  );
  log("単価タブにキャンセル規定が表示される", (await clientPanel.textContent()).includes("キャンセル規定：キャンセル不可"));

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

  // --- agency switches to「締切後はキャンセル料」(締切は30日前＝もう過ぎている) ---
  psql(
    `update "CompanyPlacementRate" set "cancelPolicy"='FEE_AFTER_DEADLINE', "cancelDeadlineDaysBefore"=30, "cancelDeadlineTime"='00:00', "cancelFeeAmount"=5000 where "companyRelationshipId"='${relId}' and "taskName"='取消テスト業務';`,
  );
  confirm = await openDeleteConfirm();
  confirmText = await confirm.textContent();
  log("締切後はキャンセル料の合計が表示される", confirmText.includes("キャンセル料 合計5,000円"));
  const deleteBtn = confirm.getByRole("button", { name: "削除する" });
  log("了承のチェックを入れるまで削除できない", await deleteBtn.isDisabled());
  await confirm.getByLabel("キャンセル料がかかることを了承して取り消す").check();
  await deleteBtn.click();
  await client.waitForTimeout(1000);

  log("オーダーが削除される", psql(`select status from "PublicRecruitment" where id='${recruitmentId}';`) === "DELETED");
  log("派遣スタッフのシフトが取り消される", psql(`select status from "Shift" where id='${shiftId}';`) === "CANCELLED");
  log("キャンセル料5000円が記録される", psql(`select "feeAmount" from "ShiftCancellation" where "shiftId"='${shiftId}';`) === "5000");

  const notifyLog = execSync("tail -c 400000 /tmp/nextdev.log").toString();
  log("派遣元の通知先へ取り消しのメールが送られる", notifyLog.includes("依頼主がシフトを取り消しました"));

  // --- agency invoice for that month contains the キャンセル料 line ---
  const month = psql(`select to_char(date, 'YYYY-MM') from "Shift" where id='${shiftId}';`);
  await agency.goto(`http://localhost:3000/company/invoices?month=${month}&client=${relId}`);
  await agency.waitForTimeout(800);
  const feeLine = psql(
    `select il.amount || '|' || il.description from "InvoiceLine" il join "Invoice" i on i.id=il."invoiceId" where i."companyRelationshipId"='${relId}' and il."shiftId"='${shiftId}';`,
  );
  log("その月の請求書にキャンセル料の明細(5000円)が載る", feeLine.startsWith("5000|") && feeLine.includes("キャンセル料"));

  console.log(process.exitCode ? "CLIENT CANCEL POLICY SMOKE TEST HAD FAILURES" : "CLIENT CANCEL POLICY SMOKE TEST PASSED");
} catch (err) {
  console.error("CLIENT CANCEL POLICY SMOKE TEST FAILED", err);
  await client.screenshot({ path: "/tmp/smoke-cancel-policy-client-failure.png" });
  await agency.screenshot({ path: "/tmp/smoke-cancel-policy-agency-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
