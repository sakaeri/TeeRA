import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 身分証・振込先の必須化（既定でオン）とは関係ない確認なので、この確認で作った会社では必須を外す
// （外すと、以前と同じく「契約内容の確認 → 身分証 → 振込先」の順になる）
function disableRequiredDocuments() {
  execSync(
    `PGPASSWORD=postgres psql -h localhost -U postgres -d teera -c "update \\"ContractTemplate\\" set \\"requireIdDocument\\"=false, \\"requireBankInfo\\"=false where \\"createdAt\\" > now() - interval '30 minutes';"`,
  );
}

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
const admin = await (await browser.newContext()).newPage();
const staffA = await (await browser.newContext()).newPage();
const staffC = await (await browser.newContext()).newPage();

const adminEmail = `consent-admin-${Date.now()}@example.com`;
const staffAEmail = `consent-staffa-${Date.now()}@example.com`;
const staffCEmail = `consent-staffc-${Date.now()}@example.com`;

async function inviteAndJoin(page, name, email) {
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await page.goto(inviteUrl);
  await page.click("text=アカウントを作成して参加する");
  await page.fill("#name", name);
  await page.fill("#email", email);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL(new RegExp("/invite/"));
  await page.click("text=参加する");
  await page.waitForURL("http://localhost:3000/staff");
  return psql(`select id from "User" where email='${email}';`);
}

async function generateContract(staffName) {
  await admin.goto("http://localhost:3000/company/roster");
  await admin.reload();
  await admin.waitForTimeout(500);
  await admin.locator("tbody tr", { hasText: staffName }).click();
  await admin.waitForTimeout(300);
  const panel = admin.locator("div.fixed.inset-0.z-30").first();
  await panel.getByRole("button", { name: "契約書管理" }).click();
  await panel.getByRole("button", { name: "＋契約書を追加" }).click();
  await panel.getByRole("button", { name: "契約書を生成" }).click();
  await admin.waitForTimeout(200);
  const choose = admin.locator("div.fixed.inset-0.z-30").last();
  await choose.locator("select").selectOption({ label: "アルバイト・キャディ業務" });
  await choose.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  const assign = admin.locator("div.fixed.inset-0.z-30").last();
  await assign.getByRole("button", { name: "このテンプレートのまま契約する" }).click();
  await admin.waitForTimeout(700);
}

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "同意フロー管理者");
  await admin.fill("#email", adminEmail);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "同意フロー株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='同意フロー株式会社' order by "createdAt" desc limit 1;`);

  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("キャディ業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("DAILY");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("9000");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);

  const staffAUserId = await inviteAndJoin(staffA, "同意花子", staffAEmail);
  const staffCUserId = await inviteAndJoin(staffC, "同意次郎", staffCEmail);

  // staffC already has ID docs on file (rehire-style scenario) but no bank info yet
  psql(
    `update "CompanyMembership" set "idDocumentFrontUrl"='https://example.com/front.png', "idDocumentBackUrl"='https://example.com/back.png' ` +
      `where "userId"='${staffCUserId}';`,
  );

  // --- staff A: fresh, nothing on file
  await generateContract("同意花子");
  const statusAfterGenerate = psql(`select status from "StaffContract" where "staffUserId"='${staffAUserId}';`);
  log("生成直後はACTIVEではなくPENDING_CONSENT（本人の同意待ち）", statusAfterGenerate === "PENDING_CONSENT");

  // シフト日付は"current_date"を仮定せず、実際に生成された契約の
  // contractStartDateに合わせる（UI側はtodayJst()でデフォルト設定するため、
  // タイムゾーンの境界時刻によってはPostgresのcurrent_dateと1日ずれること
  // があり、それに引きずられて契約の対象外と判定されるのを防ぐ）。
  const contractStartDate = psql(
    `select "contractStartDate" from "StaffContract" where "staffUserId"='${staffAUserId}';`,
  );
  const shiftId = psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffAUserId}', 'INHOUSE', 'キャディ業務', '${contractStartDate}', '09:00', '17:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "clockIn", "clockOut", "computedMinutes", "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${shiftId}', '${staffAUserId}', 'WORKED', 'APPROVED', now() - interval '8 hour', now(), 480, now(), now());`,
  );
  const thisMonth = contractStartDate.slice(0, 7);
  await admin.goto(`http://localhost:3000/company/payroll?month=${thisMonth}&staff=${staffAUserId}`);
  await admin.waitForTimeout(600);
  const lineForPendingContract = psql(`select count(*) from "SalarySlipLine" where "shiftId"='${shiftId}';`);
  log("同意前の契約は給与計算に使われない（確定シフトがあっても明細行は作られない）", lineForPendingContract === "0");

  disableRequiredDocuments();
  await staffA.goto(`http://localhost:3000/staff/contracts/${companyId}`);
  await staffA.waitForTimeout(500);
  let bodyA = await staffA.textContent("body");
  log("スタッフ側に「新しい契約書があります」と出る", bodyA.includes("新しい契約書があります"));

  // 「契約書を確認する」で、その場で全画面の流れが開く（必須の書類が無いので 内容 → 署名 の2手順）
  await staffA.getByRole("button", { name: "契約書を確認する" }).click();
  const wizardA = staffA.getByRole("dialog", { name: "契約書の確認" });
  await wizardA.waitFor({ timeout: 15000 });
  let wizardText = await wizardA.innerText();
  log("1/2 契約書の内容が開き、全文が読める", wizardText.includes("1/2 契約書の内容") && wizardText.includes("キャディ業務"));
  await wizardA.getByRole("button", { name: "次へ", exact: true }).click();
  wizardText = await wizardA.innerText();
  log("2/2 署名で氏名・住所・電話番号を入力する", wizardText.includes("2/2 署名") && wizardText.includes("住所") && wizardText.includes("電話番号"));
  const consentButtonA = wizardA.getByRole("button", { name: "内容を確認しました（同意する）" });
  log("住所・電話番号が未入力のうちは同意ボタンが無効", await consentButtonA.isDisabled());
  await wizardA.getByRole("button", { name: "戻る" }).click();
  log("「戻る」で前の手順に戻れる", (await wizardA.innerText()).includes("1/2 契約書の内容"));
  await wizardA.getByRole("button", { name: "次へ", exact: true }).click();
  await wizardA.locator('label:has-text("氏名") input').fill("同意花子");
  await wizardA.locator('label:has-text("住所") input').fill("東京都千代田区1-1-1");
  await wizardA.locator('label:has-text("電話番号") input').fill("090-1111-2222");
  await consentButtonA.click();
  await wizardA.waitFor({ state: "detached", timeout: 30000 });

  const statusAfterConsent = psql(
    `select status || '|' || ("consentedAt" is not null)::text || '|' || "partyName" || '|' || "partyAddress" || '|' || "partyPhoneNumber" from "StaffContract" where "staffUserId"='${staffAUserId}';`,
  );
  log(
    "同意ボタンでACTIVEになり、同意日時・入力した氏名住所電話番号が記録される",
    statusAfterConsent === "ACTIVE|true|同意花子|東京都千代田区1-1-1|090-1111-2222",
  );

  await admin.goto(`http://localhost:3000/company/payroll?month=${thisMonth}&staff=${staffAUserId}`);
  await admin.waitForTimeout(600);
  const lineAfterConsent = psql(
    `select json_build_object('rate', rate, 'amount', amount) from "SalarySlipLine" where "shiftId"='${shiftId}';`,
  );
  const parsedLine = lineAfterConsent ? JSON.parse(lineAfterConsent) : null;
  log(
    "同意後は給与計算にちゃんと使われる（日給9000円）",
    parsedLine && Number(parsedLine.rate) === 9000 && Number(parsedLine.amount) === 9000,
  );

  // --- staff C: 身分証は提出済み・振込先はまだ。この契約書では両方必須
  await generateContract("同意次郎");
  psql(
    `update "ContractTemplate" set "requireIdDocument"=true, "requireBankInfo"=true where id=(select "templateId" from "StaffContract" where "staffUserId"='${staffCUserId}' and status='PENDING_CONSENT');`,
  );
  await staffC.goto(`http://localhost:3000/staff/contracts/${companyId}`);
  await staffC.waitForTimeout(500);
  await staffC.getByRole("button", { name: "契約書を確認する" }).click();
  const wizardC = staffC.getByRole("dialog", { name: "契約書の確認" });
  await wizardC.waitFor({ timeout: 15000 });
  log("必須の書類があると 内容 → 身分証 → 振込先 → 署名 の4手順になる", (await wizardC.innerText()).includes("1/4 契約書の内容"));
  await wizardC.getByRole("button", { name: "次へ", exact: true }).click();
  let wizardTextC = await wizardC.innerText();
  log(
    "2/4 身分証明書の添付：提出済みなら「提出済み」と出て、そのまま次へ進める",
    wizardTextC.includes("2/4 身分証明書の添付") &&
      wizardTextC.includes("提出済み") &&
      !(await wizardC.getByRole("button", { name: "次へ", exact: true }).isDisabled()),
  );
  await wizardC.getByRole("button", { name: "次へ", exact: true }).click();
  wizardTextC = await wizardC.innerText();
  log(
    "3/4 振込先情報：未入力のうちは次へ進めない",
    wizardTextC.includes("3/4 振込先情報") && (await wizardC.getByRole("button", { name: "次へ", exact: true }).isDisabled()),
  );
  await wizardC.locator('label:has-text("銀行名") input').fill("同意銀行");
  await wizardC.locator('label:has-text("口座番号") input').fill("7654321");
  await wizardC.locator('label:has-text("口座名義") input').fill("ドウイ ジロウ");
  await wizardC.getByRole("button", { name: "次へ", exact: true }).click();
  await wizardC.getByText("4/4 署名").waitFor({ timeout: 15000 });
  const bankAfterSave = psql(`select "bankName" || '|' || "accountNumber" from "CompanyMembership" where "userId"='${staffCUserId}';`);
  log("振込先は「次へ」で保存される", bankAfterSave === "同意銀行|7654321");

  // 途中で閉じても、次に開くと振込先は入ったまま
  await wizardC.getByRole("button", { name: "閉じる" }).click();
  await staffC.waitForTimeout(800);
  await staffC.getByRole("button", { name: "契約書を確認する" }).click();
  await wizardC.waitFor({ timeout: 15000 });
  await wizardC.getByRole("button", { name: "次へ", exact: true }).click();
  await wizardC.getByRole("button", { name: "次へ", exact: true }).click();
  log("途中で閉じても、次に開くと入力済みの振込先が入っている", (await wizardC.locator('label:has-text("銀行名") input').inputValue()) === "同意銀行");
  await wizardC.getByRole("button", { name: "次へ", exact: true }).click();
  await wizardC.getByText("4/4 署名").waitFor({ timeout: 15000 });
  await wizardC.locator('label:has-text("住所") input').fill("東京都中央区2-2-2");
  await wizardC.locator('label:has-text("電話番号") input').fill("090-3333-4444");
  await wizardC.getByRole("button", { name: "内容を確認しました（同意する）" }).click();
  await wizardC.waitFor({ state: "detached", timeout: 30000 });
  await staffC.waitForTimeout(800);
  const bodyC = await staffC.textContent("body");
  log(
    "同意すると流れが閉じ、契約中の雇用契約書に表示される",
    bodyC.includes("契約中の雇用契約書") && !bodyC.includes("新しい契約書があります"),
  );

  console.log(process.exitCode ? "CONTRACT CONSENT FLOW SMOKE TEST HAD FAILURES" : "CONTRACT CONSENT FLOW SMOKE TEST PASSED");
} catch (err) {
  console.error("CONTRACT CONSENT FLOW SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-consent-admin-failure.png" });
  await staffA.screenshot({ path: "/tmp/smoke-consent-staffa-failure.png" });
  await staffC.screenshot({ path: "/tmp/smoke-consent-staffc-failure.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
