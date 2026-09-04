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
const client = await (await browser.newContext()).newPage();
const agency = await (await browser.newContext()).newPage();

const clientEmail = `agperm-client-${Date.now()}@example.com`;
const agencyEmail = `agperm-agency-${Date.now()}@example.com`;
const runId = Date.now();
const clientCompanyName = `権限確認依頼主${runId}`;
const agencyCompanyName = `権限確認派遣元${runId}`;

try {
  // --- ① client(owner) registers, then invites an agency to link (AGENCY_UPGRADE) ---
  // ownerCompanyIdはこのclient会社になる — 派遣会社(agencyCompanyId)側では
  // ないオーナーのケースを再現する。
  await client.goto("http://localhost:3000/register");
  await client.fill("#name", "権限確認依頼主担当者");
  await client.fill("#email", clientEmail);
  await client.fill("#password", "password123");
  await client.click("button[type=submit]");
  await client.waitForURL("http://localhost:3000/register/company");
  await client.fill("#name", clientCompanyName);
  await client.click("button[type=submit]");
  await client.waitForURL("http://localhost:3000/company");
  const clientCompanyId = psql(`select id from "Company" where name='${clientCompanyName}';`);

  await client.goto("http://localhost:3000/company/roster");
  await client.click("text=派遣会社一覧");
  await client.waitForTimeout(200);
  await client.click("text=＋派遣会社を追加する");
  await client.waitForTimeout(200);
  await client.click("text=本アカウントを招待");
  await client.waitForTimeout(200);
  await client.getByRole("button", { name: "招待URLを発行する" }).click();
  await client.waitForSelector('input[readonly]');
  const relInviteUrl = await client.locator('input[readonly]').inputValue();

  await agency.goto(relInviteUrl);
  await agency.click("text=アカウントを作成して参加する");
  await agency.fill("#name", "権限確認派遣元担当者");
  await agency.fill("#email", agencyEmail);
  await agency.fill("#password", "password123");
  await agency.click("button[type=submit]");
  await agency.waitForURL(/\/register\/company\?invite=/);
  await agency.fill("#name", agencyCompanyName);
  await agency.click("button[type=submit]");
  await agency.waitForURL(/\/invite\//);
  await agency.click("text=この会社として招待を受け取る");
  await agency.waitForURL("http://localhost:3000/company/roster");
  const agencyCompanyId = psql(`select id from "Company" where name='${agencyCompanyName}';`);
  const relId = psql(`select id from "CompanyRelationship" where "ownerCompanyId"='${clientCompanyId}' order by "createdAt" desc limit 1;`);

  const ownerCheck = psql(`select "ownerCompanyId", "agencyCompanyId", "clientCompanyId" from "CompanyRelationship" where id='${relId}';`);
  log("① オーナーは依頼主側（派遣会社側ではない）というケースを再現できた", ownerCheck === `${clientCompanyId}|${agencyCompanyId}|${clientCompanyId}`);

  // 招待「される」側（派遣会社）も、招待した側とは関係なく自分の役割の
  // フラグ(agencyEnabled)がredeemCompanyRelationshipInvite側で自動的に
  // 立っているはず — シフト作成の依頼主ピッカーがすぐ使える。
  const agencyEnabledAfterRedeem = psql(`select "agencyEnabled" from "Company" where id='${agencyCompanyId}';`);
  log("① 招待された側の派遣会社もagencyEnabledが自動で立つ（招待した側とは無関係）", agencyEnabledAfterRedeem === "t");

  // --- ② the agency (non-owner) can still register a new 業務内容 via シフト作成 ---
  await agency.goto("http://localhost:3000/company/roster");
  await agency.click("text=＋スタッフを追加する");
  await agency.click("text=仮アカウントを作成");
  await agency.fill('input[placeholder="名称を入力"]', "権限確認スタッフ");
  await agency.getByRole("button", { name: "作成", exact: true }).click();
  await agency.waitForTimeout(600);

  await agency.goto("http://localhost:3000/company/calendar");
  await agency.locator("button", { hasText: "＋" }).last().click();
  await agency.getByText("シフトを作成").click();
  const modal = agency.locator("div.fixed.inset-0.z-20").last();
  if (await modal.getByText("どのチームのシフトを作成しますか？").count()) {
    await modal.getByRole("button").first().click();
    await agency.waitForTimeout(200);
  }
  await modal.getByRole("button", { name: clientCompanyName }).click();
  await modal.getByRole("button", { name: "＋ 新しい業務内容を追加する" }).click();
  await modal.locator('input[placeholder*="業務内容"]').fill("権限確認業務");
  await modal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await agency.waitForTimeout(400);
  let modalBody = await modal.textContent();
  log("② オーナーでない派遣会社側でも業務内容の登録が拒否されない（forbiddenにならない）", !modalBody.includes("作成に失敗"));

  const taskRegistered = psql(`select count(*) from "CompanyPlacementRate" where "companyRelationshipId"='${relId}' and "taskName"='権限確認業務';`);
  log("業務内容がDBに登録された", taskRegistered === "1");
  await agency.keyboard.press("Escape");
  await agency.waitForTimeout(200);

  // --- ③ the agency (non-owner) can set the rate for it ---
  await agency.goto("http://localhost:3000/company/roster");
  await agency.click("text=依頼主一覧");
  await agency.waitForTimeout(200);
  await agency.click(`text=${clientCompanyName}`);
  await agency.waitForTimeout(300);
  const agencyPanel = agency.locator("div.fixed.inset-0.z-30").last();
  await agencyPanel.getByRole("button", { name: "単価", exact: true }).click();
  await agency.waitForTimeout(200);
  log("③ 単価タブが派遣会社側（非オーナー）にも見える", (await agencyPanel.getByText("単価未設定").count()) > 0);
  await agencyPanel.getByRole("button", { name: "単価を変更" }).click();
  await agencyPanel.locator('input[type=number]').fill("2800");
  await agencyPanel.getByRole("button", { name: "保存" }).click();
  await agency.waitForTimeout(500);

  const rateSet = psql(
    `select count(*) from "CompanyPlacementRateVersion" v join "CompanyPlacementRate" r on r.id=v."placementRateId" ` +
      `where r."companyRelationshipId"='${relId}' and r."taskName"='権限確認業務' and v.amount=2800;`,
  );
  log("③ オーナーでない派遣会社側から単価が保存できる（以前はforbiddenで弾かれていた）", rateSet === "1");

  // --- ④ notes: 完全に自社限定、相手には一切見えない ---
  await agencyPanel.getByRole("button", { name: "情報メモ" }).click();
  await agency.waitForTimeout(200);
  await agencyPanel.getByRole("button", { name: "＋メモ作成" }).click();
  await agency.waitForTimeout(200);
  const agencyNoteForm = agency.locator("div.fixed.inset-0.z-40").last();
  await agencyNoteForm.locator('textarea[placeholder="この取引先に関するメモを入力"]').fill("依頼主の緊急連絡先: 090-0000-0000");
  await agencyNoteForm.getByRole("button", { name: "作成", exact: true }).click();
  await agency.waitForTimeout(500);
  let agencyNoteBody = await agencyPanel.textContent();
  log("④ 派遣会社側が自分のメモを見られる", agencyNoteBody.includes("依頼主の緊急連絡先"));

  await client.goto("http://localhost:3000/company/roster");
  await client.click("text=派遣会社一覧");
  await client.waitForTimeout(200);
  await client.click(`text=${agencyCompanyName}`);
  await client.waitForTimeout(300);
  const clientPanel = client.locator("div.fixed.inset-0.z-30").last();
  await clientPanel.getByRole("button", { name: "情報メモ" }).click();
  await client.waitForTimeout(200);
  let clientNoteBody = await clientPanel.textContent();
  log("④ 依頼主側からは派遣会社が書いたメモが一切見えない", !clientNoteBody.includes("依頼主の緊急連絡先") && clientNoteBody.includes("メモはまだありません"));

  await clientPanel.getByRole("button", { name: "＋メモ作成" }).click();
  await client.waitForTimeout(200);
  const clientNoteForm = client.locator("div.fixed.inset-0.z-40").last();
  await clientNoteForm.locator('textarea[placeholder="この取引先に関するメモを入力"]').fill("派遣会社担当者は電話が繋がりにくい");
  await clientNoteForm.getByRole("button", { name: "作成", exact: true }).click();
  await client.waitForTimeout(500);
  clientNoteBody = await clientPanel.textContent();
  log("依頼主側が自分のメモを見られる", clientNoteBody.includes("派遣会社担当者は電話が繋がりにくい"));

  await agency.goto("http://localhost:3000/company/roster");
  await agency.click("text=依頼主一覧");
  await agency.waitForTimeout(200);
  await agency.click(`text=${clientCompanyName}`);
  await agency.waitForTimeout(300);
  const agencyPanel2 = agency.locator("div.fixed.inset-0.z-30").last();
  await agencyPanel2.getByRole("button", { name: "情報メモ" }).click();
  await agency.waitForTimeout(200);
  agencyNoteBody = await agencyPanel2.textContent();
  log("④ 派遣会社側からは依頼主が書いたメモが一切見えない（自分のメモだけ見える）", agencyNoteBody.includes("依頼主の緊急連絡先") && !agencyNoteBody.includes("電話が繋がりにくい"));

  const noteRowCount = psql(`select count(*) from "RelationshipNote" where "companyRelationshipId"='${relId}';`);
  log("DBには2社分（2件）のメモが別々に存在する", noteRowCount === "2");
  const distinctCompanyCount = psql(`select count(distinct "companyId") from "RelationshipNote" where "companyRelationshipId"='${relId}';`);
  log("それぞれ別のcompanyIdに紐づいている", distinctCompanyCount === "2");

  console.log(process.exitCode ? "RELATIONSHIP AGENCY PERMISSIONS SMOKE TEST HAD FAILURES" : "RELATIONSHIP AGENCY PERMISSIONS SMOKE TEST PASSED");
} catch (err) {
  console.error("RELATIONSHIP AGENCY PERMISSIONS SMOKE TEST FAILED", err);
  await client.screenshot({ path: "/tmp/smoke-relationship-agency-permissions-client-failure.png" });
  await agency.screenshot({ path: "/tmp/smoke-relationship-agency-permissions-agency-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
