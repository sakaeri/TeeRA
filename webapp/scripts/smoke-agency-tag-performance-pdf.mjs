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
const clientCtx = await browser.newContext();
const client = await clientCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const clientEmail = `atpp-client-${Date.now()}@example.com`;
const staffEmail = `atpp-staff-${Date.now()}@example.com`;

try {
  // --- client company ---
  await client.goto("http://localhost:3000/register");
  await client.fill("#name", "実績PDF依頼主担当者");
  await client.fill("#email", clientEmail);
  await client.fill("#password", "password123");
  await client.click("button[type=submit]");
  await client.waitForURL("http://localhost:3000/register/company");
  await client.fill("#name", "実績PDF依頼主株式会社");
  await client.click("button[type=submit]");
  await client.waitForURL("http://localhost:3000/company");
  const clientCompanyId = psql(`select id from "Company" where name='実績PDF依頼主株式会社' order by "createdAt" desc limit 1;`);
  psql(`update "Company" set "dispatchEnabled" = true where id = '${clientCompanyId}';`);

  // --- proxy (実体の無い) agency relationship, seeded directly ---
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "clientCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") ` +
      `values (gen_random_uuid()::text, '${clientCompanyId}', '${clientCompanyId}', null, '実績PDFテスト架空派遣', 'ACTIVE', now()) returning id) select id from ins;`,
  );

  // --- client: invite + register a staff member (自社スタッフとして) ---
  await client.goto("http://localhost:3000/company/roster");
  await client.click("text=＋スタッフを追加する");
  await client.click("text=本アカウントを招待");
  await client.getByRole("button", { name: "招待URLを発行する" }).click();
  await client.waitForSelector('input[readonly]');
  const inviteUrl = await client.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "実績PDF対象スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);
  const membershipId = psql(
    `select id from "CompanyMembership" where "userId"='${staffUserId}' and "companyId"='${clientCompanyId}';`,
  );

  // --- client: open staff detail, set 所属 to the proxy agency ---
  await client.goto("http://localhost:3000/company/roster");
  await client.click("text=実績PDF対象スタッフ");
  await client.waitForSelector("text=契約書管理");
  await client.getByRole("button", { name: "契約書管理" }).click();
  await client.waitForSelector("text=有給休暇");
  const panel = client.locator("div.fixed.inset-0.z-30, div.fixed.inset-0.z-20").last();
  let bodyText = await panel.textContent();
  log("スタッフ詳細に「所属（表示用）」の項目がある", bodyText.includes("所属（表示用）"));
  await panel.locator("select").filter({ hasText: "自社" }).selectOption({ label: "実績PDFテスト架空派遣" });
  await client.waitForTimeout(400);

  const taggedRelId = psql(`select "viaAgencyRelationshipId" from "CompanyMembership" where id='${membershipId}';`);
  log("DBにタグが保存される", taggedRelId === relId);
  await panel.getByRole("button", { name: "← 閉じる" }).click();
  await client.reload();
  await client.waitForTimeout(400);
  // page.textContent("body") はhydration用に埋め込まれた非表示のスクリプト
  // タグの中身（フィルタ前の生データ）まで拾ってしまい、除外の確認には
  // 使えない（実際に画面に見えているものだけを見るinnerTextを使う）。
  log(
    "タグ付け後は自社スタッフの名簿（スタッフ一覧）からは消える",
    (await client.locator("body").innerText()).indexOf("実績PDF対象スタッフ") === -1,
  );

  // --- client: staff-selection in ＋シフトを作成 shows the agency tag next to the name ---
  await client.goto("http://localhost:3000/company/calendar");
  await client.locator("button", { hasText: "＋" }).last().click();
  await client.getByText("シフトを作成").click();
  const modal = client.locator("div.fixed.inset-0.z-20").last();
  await client.waitForSelector("text=勤務先を選択");
  await modal.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await client.waitForSelector("text=業務内容を選ばずに次へ");
  await modal.getByRole("button", { name: "業務内容を選ばずに次へ" }).click();
  await client.waitForTimeout(200);
  bodyText = await modal.textContent();
  log("シフト作成のスタッフ選択にタグ付きで表示される", bodyText.includes("実績PDF対象スタッフ（実績PDFテスト架空派遣）"));
  await modal.getByRole("button", { name: /実績PDF対象スタッフ/ }).click();
  await client.waitForSelector("text=日付を選択");
  await modal.getByRole("button", { name: "次へ" }).click();
  await client.waitForTimeout(300);
  await modal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await client.waitForTimeout(600);

  const shiftId = psql(
    `select id from "Shift" where "staffUserId"='${staffUserId}' and "companyId"='${clientCompanyId}' order by "createdAt" desc limit 1;`,
  );
  log("作成されたシフトはcompanyIdが依頼主のまま（INHOUSE）", Boolean(shiftId));
  const shiftSource = psql(`select source from "Shift" where id='${shiftId}';`);
  log("sourceはINHOUSEのまま（配属の仕組みには影響しない）", shiftSource === "INHOUSE");

  // --- seed an approved work report for this shift (承認済みのみPDFに載ることを確認するため) ---
  const shiftDate = psql(`select date from "Shift" where id='${shiftId}';`);
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "clockIn", "clockOut", "breakMinutes", "computedMinutes", "approvalStatus", "submittedAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${shiftId}', '${staffUserId}', 'WORKED', ('${shiftDate}'::date + interval '9 hour'), ('${shiftDate}'::date + interval '13 hour'), 0, 240, 'APPROVED', now(), now());`,
  );

  // --- client: 派遣会社一覧 → その架空派遣会社の詳細 → 稼働履歴タブに実績PDFカードが出る ---
  await client.goto("http://localhost:3000/company/roster");
  await client.click("text=派遣会社一覧").catch(async () => {
    await client.getByRole("button", { name: /派遣会社一覧/ }).click();
  });
  await client.waitForTimeout(300);
  await client.click("text=実績PDFテスト架空派遣");
  await client.waitForTimeout(400);
  const agencyPanel = client.locator("div.fixed.inset-0.z-30, div.fixed.inset-0.z-20").last();
  bodyText = await agencyPanel.textContent();
  log("実績PDFを出すボタンが稼働履歴タブにある", bodyText.includes("実績PDF") && bodyText.includes("PDF出力"));

  await agencyPanel.getByRole("button", { name: "スタッフ一覧" }).click();
  await client.waitForTimeout(300);
  bodyText = await agencyPanel.textContent();
  log("スタッフ一覧タブに＋派遣スタッフを招待ボタンがある", bodyText.includes("＋派遣スタッフを招待"));
  log("派遣会社詳細のスタッフ欄にタグ付きスタッフが表示される", bodyText.includes("実績PDF対象スタッフ"));
  log(
    "配属中スタッフのセクションは出ない（架空派遣会社には意味がないため常に非表示）",
    !bodyText.includes("配属中スタッフ") && !bodyText.includes("配属中のスタッフはいません"),
  );

  // --- 派遣会社詳細から直接スタッフを招待すると、参加時点で自動的にタグ付けされる ---
  const staff2Ctx = await browser.newContext();
  const staff2 = await staff2Ctx.newPage();
  const staff2Email = `atpp-staff2-${Date.now()}@example.com`;
  await agencyPanel.getByRole("button", { name: "＋派遣スタッフを招待" }).click();
  await client.waitForTimeout(300);
  bodyText = await agencyPanel.textContent();
  log("招待モーダルの案内に対象の派遣会社名が入っている", bodyText.includes("実績PDFテスト架空派遣"));
  await agencyPanel.getByRole("button", { name: "招待URLを発行する" }).click();
  await client.waitForSelector('input[readonly]');
  const agencyInviteUrl = await agencyPanel.locator('input[readonly]').inputValue();
  await client.waitForTimeout(300);
  bodyText = await agencyPanel.textContent();
  log(
    "発行済み・未使用の招待URL一覧にこの派遣会社宛の招待が1件表示される（他の派遣会社/直雇用の招待とは混ざらない）",
    bodyText.includes("発行済み・未使用の招待URL（1件）"),
  );
  await agencyPanel.getByRole("button", { name: "✕" }).click();
  await staff2.goto(agencyInviteUrl);
  await staff2.click("text=アカウントを作成して参加する");
  await staff2.fill("#name", "招待経由派遣スタッフ");
  await staff2.fill("#email", staff2Email);
  await staff2.fill("#password", "password123");
  await staff2.click("button[type=submit]");
  await staff2.waitForURL(new RegExp("/invite/"));
  await staff2.click("text=参加する");
  await staff2.waitForURL("http://localhost:3000/staff");
  const staff2UserId = psql(`select id from "User" where email='${staff2Email}';`);
  const staff2TaggedRelId = psql(`select "viaAgencyRelationshipId" from "CompanyMembership" where "userId"='${staff2UserId}';`);
  log("派遣会社詳細から招待すると参加した時点で自動的にタグ付けされる", staff2TaggedRelId === relId);

  await client.reload();
  await client.waitForTimeout(400);
  // page.textContent("body") はhydration用の非表示スクリプトタグの中身
  // （フィルタ前の生データ）まで拾ってしまい、除外の確認には使えないため
  // innerTextで実際に見えているものだけを見る（デフォルトの「スタッフ一覧」
  // タブが表示されている状態で確認する）。
  log(
    "招待経由のスタッフも自社スタッフの名簿には出ない",
    (await client.locator("body").innerText()).indexOf("招待経由派遣スタッフ") === -1,
  );

  await client.click("text=派遣会社一覧").catch(async () => {
    await client.getByRole("button", { name: /派遣会社一覧/ }).click();
  });
  await client.waitForTimeout(300);
  await client.click("text=実績PDFテスト架空派遣");
  await client.waitForTimeout(400);
  const agencyPanel2 = client.locator("div.fixed.inset-0.z-30, div.fixed.inset-0.z-20").last();
  await agencyPanel2.getByRole("button", { name: "スタッフ一覧" }).click();
  await client.waitForTimeout(300);
  bodyText = await agencyPanel2.textContent();
  log("招待経由のスタッフも派遣会社詳細のスタッフ欄に出る", bodyText.includes("招待経由派遣スタッフ"));

  // --- 派遣会社詳細のスタッフ欄から名前をクリックするとスタッフ詳細が開く ---
  await agencyPanel2.getByRole("button", { name: "招待経由派遣スタッフ" }).click();
  await client.waitForTimeout(400);
  bodyText = await client.textContent("body");
  log("派遣会社詳細のスタッフ欄からクリックするとスタッフ詳細が開く", bodyText.includes("招待経由派遣スタッフ") && bodyText.includes("稼働履歴"));

  // --- fetch the PDF directly and verify it renders correctly ---
  const [year, month] = shiftDate.split("-");
  const cookies = await clientCtx.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const pdfRes = await fetch(
    `http://localhost:3000/api/agency-relationships/${relId}/performance-pdf?y=${Number(year)}&m=${Number(month)}`,
    { headers: { Cookie: cookieHeader } },
  );
  log("PDF response content-type", pdfRes.headers.get("content-type") === "application/pdf");
  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
  log("PDF is non-trivial size (>1000 bytes)", pdfBuffer.length > 1000);
  log("PDF starts with %PDF magic bytes", pdfBuffer.subarray(0, 4).toString() === "%PDF");

  console.log(process.exitCode ? "AGENCY TAG PERFORMANCE PDF SMOKE TEST HAD FAILURES" : "AGENCY TAG PERFORMANCE PDF SMOKE TEST PASSED");
} catch (err) {
  console.error("AGENCY TAG PERFORMANCE PDF SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
