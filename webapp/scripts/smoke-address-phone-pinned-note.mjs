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
const admin = await (await browser.newContext()).newPage();
const staff = await (await browser.newContext()).newPage();
const adminEmail = `pinned-note-admin-${Date.now()}@example.com`;
const staffEmail = `pinned-note-staff-${Date.now()}@example.com`;

try {
  // --- setup: company + template + real staff invite ---
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "ピン留め管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "ピン留め株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("検証業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("HOURLY");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1000");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  await admin.click("text=✕");

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "ピン留め花子");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // --- generate + consent (staff enters address/phone) ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.reload();
  await admin.waitForTimeout(400);
  await admin.locator("tbody tr", { hasText: "ピン留め花子" }).click();
  await admin.waitForTimeout(300);
  const panel = admin.locator("div.fixed.inset-0.z-30").first();
  await panel.getByRole("button", { name: "契約書管理" }).click();
  await panel.getByRole("button", { name: "＋契約書を追加" }).click();
  await panel.getByRole("button", { name: "契約書を生成" }).click();
  await admin.waitForTimeout(200);
  const chooseModal = admin.locator("div.fixed.inset-0.z-30").last();
  await chooseModal.locator("select").selectOption({ label: "アルバイト・検証業務" });
  await chooseModal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  const assignModal = admin.locator("div.fixed.inset-0.z-30").last();
  await assignModal.getByRole("button", { name: "このテンプレートのまま契約する" }).click();
  await admin.waitForTimeout(500);

  const companyId = psql(`select id from "Company" where name='ピン留め株式会社' order by "createdAt" desc limit 1;`);
  await staff.goto(`http://localhost:3000/staff/contracts/${companyId}`);
  await staff.waitForTimeout(500);
  await staff.getByRole("button", { name: "契約書の全文を確認する" }).click();
  await admin.waitForTimeout(200);
  const consentModal = staff.locator("div.fixed.inset-0.z-30").last();

  // ❶ regression check: the "*" sits on the same line as the label text
  const nameLabelSpan = consentModal.locator("label:has-text('氏名') span").first();
  const nameLabelBox = await nameLabelSpan.boundingBox();
  const asteriskBox = await consentModal.locator("label:has-text('氏名') span span").first().boundingBox();
  log(
    "❶ 氏名ラベルの「*」が同じ行に表示される（折り返されない）",
    Boolean(nameLabelBox && asteriskBox && Math.abs(nameLabelBox.y - asteriskBox.y) < 5),
  );

  await consentModal.locator('label:has-text("住所") input').fill("東京都渋谷区1-1-1");
  await consentModal.locator('label:has-text("電話番号") input').fill("090-1111-2222");
  await consentModal.getByRole("button", { name: "内容を確認しました（同意する）" }).click();
  await admin.waitForTimeout(800);

  // ❷ pinned block should now reflect the staff-entered address/phone, with no history entry yet (first time)
  const noteCountAfterConsent = psql(
    `select count(*) from "StaffNote" where "membershipId"=(select id from "CompanyMembership" where "userId"='${staffUserId}');`,
  );
  log("契約同意直後は履歴メモがまだ無い（初回のため）", noteCountAfterConsent === "0");

  await admin.goto("http://localhost:3000/company/roster");
  await admin.reload();
  await admin.waitForTimeout(400);
  await admin.locator("tbody tr", { hasText: "ピン留め花子" }).click();
  await admin.waitForTimeout(300);
  const panel2 = admin.locator("div.fixed.inset-0.z-30").first();
  await panel2.getByRole("button", { name: "社内メモ" }).click();
  await admin.waitForTimeout(200);
  let panelText = await panel2.textContent();
  log(
    "❷ 契約同意時に入力した住所・電話番号が社内メモの特別枠に自動反映される",
    panelText.includes("東京都渋谷区1-1-1") && panelText.includes("090-1111-2222"),
  );

  // manual edit of the pinned block -> old value demoted to history
  const pinnedBlock2 = panel2.locator("div.border-primary\\/40");
  await pinnedBlock2.getByRole("button", { name: "編集" }).click();
  await admin.waitForTimeout(200);
  await panel2.locator('label:has-text("住所") input').fill("大阪府大阪市2-2-2");
  await panel2.locator('label:has-text("電話番号") input').fill("06-3333-4444");
  await panel2.getByRole("button", { name: "保存する" }).click();
  await admin.waitForTimeout(600);

  const noteAfterEdit = psql(
    `select content from "StaffNote" where "membershipId"=(select id from "CompanyMembership" where "userId"='${staffUserId}') order by "createdAt" desc limit 1;`,
  );
  log(
    "❷ 特別枠を手修正すると変更前の値が普通のメモとして履歴に積まれる",
    noteAfterEdit.includes("東京都渋谷区1-1-1") && noteAfterEdit.includes("090-1111-2222"),
  );

  const currentUser = psql(`select coalesce(address,'') || '|' || coalesce("phoneNumber",'') from "User" where id='${staffUserId}';`);
  log("❷ User.address/phoneNumberが新しい値に更新される", currentUser === "大阪府大阪市2-2-2|06-3333-4444");

  await admin.reload();
  await admin.waitForTimeout(500);
  await admin.locator("tbody tr", { hasText: "ピン留め花子" }).click();
  await admin.waitForTimeout(300);
  const panel3 = admin.locator("div.fixed.inset-0.z-30").first();
  await panel3.getByRole("button", { name: "社内メモ" }).click();
  await admin.waitForTimeout(200);
  panelText = await panel3.textContent();
  log("❷ 特別枠は新しい値を表示し、履歴メモとして変更前の値も残る", panelText.includes("大阪府大阪市2-2-2") && panelText.includes("東京都渋谷区1-1-1"));

  // ❸ signed-at block on contract detail
  await panel3.getByRole("button", { name: "契約書管理" }).click();
  await admin.waitForTimeout(200);
  await panel3.getByRole("button", { name: "詳細確認" }).first().click();
  await admin.waitForTimeout(300);
  const detailModal = admin.locator("div.fixed.inset-0.z-30").last();
  const detailText = await detailModal.textContent();
  log(
    "❸ 契約書詳細に「署名日時：氏名：住所：電話番号」のスナップショットが表示される",
    detailText.includes("署名日時：") &&
      detailText.includes("氏名：ピン留め花子") &&
      detailText.includes("住所：東京都渋谷区1-1-1") &&
      detailText.includes("電話番号：090-1111-2222"),
  );
  log(
    "❸ 社内メモの特別枠を後から書き換えても契約書詳細のスナップショットは変わらない（旧住所のまま）",
    !detailText.includes("大阪府大阪市2-2-2"),
  );
  await detailModal.locator("text=✕").click();
  await admin.waitForTimeout(200);

  // ❹ base wage row renders type and amount on separate lines
  await panel3.getByRole("button", { name: "業務内容単価" }).click();
  await admin.waitForTimeout(200);
  const baseWageRow = panel3.locator("li", { hasText: "基本給" }).first();
  const typeLine = baseWageRow.getByText("時給", { exact: true });
  const amountLine = baseWageRow.getByText("1000円", { exact: true });
  const typeBox = await typeLine.boundingBox();
  const amountBox = await amountLine.boundingBox();
  log(
    "❹ 基本給の時給/日給/月給と金額が別の行に表示される（2段レイアウト）",
    Boolean(typeBox && amountBox && Math.abs(typeBox.y - amountBox.y) > 10),
  );

  // --- client side pinned block ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(300);
  await admin.click("text=＋依頼主を追加");
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "ピン留めゴルフ場");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(800);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(300);
  await admin.click("text=ピン留めゴルフ場");
  await admin.waitForTimeout(300);
  const clientPanel = admin.locator("div.fixed.inset-0.z-30, div.fixed.inset-0.z-20").last();
  await clientPanel.getByRole("button", { name: "社内メモ" }).click();
  await admin.waitForTimeout(200);
  const clientPinnedBlock1 = clientPanel.locator("div.border-primary\\/40");
  await clientPinnedBlock1.getByRole("button", { name: "編集" }).click();
  await admin.waitForTimeout(200);
  await clientPanel.locator('label:has-text("住所") input').fill("愛知県名古屋市3-3-3");
  await clientPanel.locator('label:has-text("電話番号") input').fill("052-5555-6666");
  await clientPanel.getByRole("button", { name: "保存する" }).click();
  await admin.waitForTimeout(600);

  const clientRelId = psql(`select id from "CompanyRelationship" where "proxyName"='ピン留めゴルフ場' order by "createdAt" desc limit 1;`);
  const clientRow = psql(`select coalesce("clientAddress",'') || '|' || coalesce("clientPhoneNumber",'') from "CompanyRelationship" where id='${clientRelId}';`);
  log("❷ 依頼主側も特別枠（住所・電話番号）が保存される", clientRow === "愛知県名古屋市3-3-3|052-5555-6666");

  // edit again -> old value demoted to RelationshipNote history
  const clientPinnedBlock2 = clientPanel.locator("div.border-primary\\/40");
  await clientPinnedBlock2.getByRole("button", { name: "編集" }).click();
  await admin.waitForTimeout(200);
  await clientPanel.locator('label:has-text("住所") input').fill("福岡県福岡市4-4-4");
  await clientPanel.locator('label:has-text("電話番号") input').fill("092-7777-8888");
  await clientPanel.getByRole("button", { name: "保存する" }).click();
  await admin.waitForTimeout(600);

  const clientNote = psql(
    `select content from "RelationshipNote" where "companyRelationshipId"='${clientRelId}' order by "createdAt" desc limit 1;`,
  );
  log(
    "❷ 依頼主側も手修正で変更前の値が履歴メモに積まれる",
    clientNote.includes("愛知県名古屋市3-3-3") && clientNote.includes("052-5555-6666"),
  );

  console.log(process.exitCode ? "ADDRESS/PHONE PINNED NOTE SMOKE TEST HAD FAILURES" : "ADDRESS/PHONE PINNED NOTE SMOKE TEST PASSED");
} catch (err) {
  console.error("ADDRESS/PHONE PINNED NOTE SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-address-phone-pinned-note-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
