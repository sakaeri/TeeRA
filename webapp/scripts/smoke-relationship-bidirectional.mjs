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
const agency = await (await browser.newContext()).newPage();
const client = await (await browser.newContext()).newPage();

const agencyEmail = `bidir-agency-${Date.now()}@example.com`;
const clientEmail = `bidir-client-${Date.now()}@example.com`;
const runId = Date.now();
const agencyCompanyName = `両方向確認派遣元${runId}`;
const clientCompanyName = `両方向確認依頼主${runId}`;

try {
  // --- agency(owner) company, real staff ---
  await agency.goto("http://localhost:3000/register");
  await agency.fill("#name", "両方向確認派遣元担当者");
  await agency.fill("#email", agencyEmail);
  await agency.fill("#password", "password123");
  await agency.click("button[type=submit]");
  await agency.waitForURL("http://localhost:3000/register/company");
  await agency.fill("#name", agencyCompanyName);
  await agency.click("button[type=submit]");
  await agency.waitForURL("http://localhost:3000/company");
  const agencyCompanyId = psql(`select id from "Company" where name='${agencyCompanyName}';`);

  await agency.goto("http://localhost:3000/company/roster");
  await agency.click("text=＋スタッフを追加する");
  await agency.click("text=仮アカウントを作成");
  await agency.fill('input[placeholder="名称を入力"]', "両方向確認スタッフ");
  await agency.getByRole("button", { name: "作成", exact: true }).click();
  await agency.waitForTimeout(600);

  // --- agency invites the client, client links their own real account (CLIENT_UPGRADE) ---
  await agency.goto("http://localhost:3000/company/roster");
  await agency.click("text=依頼主一覧");
  await agency.waitForTimeout(200);
  await agency.click("text=＋依頼主を追加する");
  await agency.waitForTimeout(200);
  await agency.click("text=本アカウントを招待");
  await agency.waitForTimeout(200);
  await agency.getByRole("button", { name: "招待URLを発行する" }).click();
  await agency.waitForSelector('input[readonly]');
  const relInviteUrl = await agency.locator('input[readonly]').inputValue();

  await client.goto(relInviteUrl);
  await client.click("text=アカウントを作成して参加する");
  await client.fill("#name", "両方向確認依頼主担当者");
  await client.fill("#email", clientEmail);
  await client.fill("#password", "password123");
  await client.click("button[type=submit]");
  await client.waitForURL(/\/register\/company\?invite=/);
  await client.fill("#name", clientCompanyName);
  await client.click("button[type=submit]");
  await client.waitForURL(/\/invite\//);
  await client.click("text=この会社として招待を受け取る");
  await client.waitForURL("http://localhost:3000/company/roster");
  const relId = psql(`select id from "CompanyRelationship" where "ownerCompanyId"='${agencyCompanyId}' order by "createdAt" desc limit 1;`);

  // --- ① bidirectional visibility: the client (non-owner) sees this in THEIR OWN 派遣会社一覧 ---
  await client.goto("http://localhost:3000/company/roster");
  await client.click("text=派遣会社一覧");
  await client.waitForTimeout(300);
  let clientBody = await client.textContent("body");
  log("① 依頼主(非オーナー)が自分の派遣会社一覧に関係を見える", clientBody.includes(agencyCompanyName));

  // --- agency assigns their staff to the client via シフト作成 (auto-placement) ---
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
  await modal.locator('input[placeholder*="業務内容"]').fill("両方向確認業務");
  await modal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await agency.waitForTimeout(300);
  await modal.getByRole("button", { name: "両方向確認スタッフ" }).click();
  await modal.getByRole("button", { name: "次へ" }).click();
  await agency.waitForTimeout(300);
  await modal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await agency.waitForTimeout(800);

  const placementRow1 = psql(
    `select id, active from "StaffPlacement" where "companyRelationshipId"='${relId}' order by "createdAt" desc limit 1;`,
  );
  log("配属記録が自動登録された（active）", placementRow1.endsWith("|t"));
  const placementId = placementRow1.split("|")[0];

  // --- ② the client sees the placed staff from THEIR OWN login, with an unplace button ---
  await client.goto("http://localhost:3000/company/roster");
  await client.click("text=派遣会社一覧");
  await client.waitForTimeout(200);
  await client.click(`text=${agencyCompanyName}`);
  await client.waitForTimeout(300);
  let clientPanel = client.locator("div.fixed.inset-0.z-30").last();
  await clientPanel.getByRole("button", { name: "スタッフ一覧" }).click();
  await client.waitForTimeout(200);
  let panelBody = await clientPanel.textContent();
  log("② 依頼主側から配属中スタッフが見える", panelBody.includes("両方向確認スタッフ") && panelBody.includes("配属中スタッフ"));
  log("単価タブは依頼主側には出ない（オーナー限定のまま）", !(await clientPanel.getByRole("button", { name: "単価", exact: true }).count()));
  log("チームとの紐付け編集ボタンも依頼主側には出ない（オーナー限定のまま）", (await clientPanel.getByRole("button", { name: "チームとの紐付けを編集" }).count()) === 0);

  // --- ③ the client (non-owner) unplaces the staff ---
  await clientPanel.getByRole("button", { name: "配属解除" }).click();
  await client.waitForTimeout(200);
  await client.getByRole("button", { name: "配属解除する" }).click();
  await client.waitForTimeout(500);

  const placementAfterUnplace = psql(`select active, "endedAt" is not null from "StaffPlacement" where id='${placementId}';`);
  log("③ 依頼主(非オーナー)からの配属解除がDBに反映される（同じ行がactive=falseに）", placementAfterUnplace === "f|t");

  panelBody = await clientPanel.textContent();
  log("配属解除後、配属中スタッフから消える", panelBody.includes("配属中のスタッフはいません"));

  await clientPanel.getByRole("button", { name: "解除履歴を表示" }).click();
  await client.waitForTimeout(200);
  panelBody = await clientPanel.textContent();
  log("解除履歴に表示される", panelBody.includes("両方向確認スタッフ") && panelBody.includes("配属解除"));

  // --- ④ the owner (agency) sees the same unplacement from their own view too ---
  await agency.goto("http://localhost:3000/company/roster");
  await agency.click("text=依頼主一覧");
  await agency.waitForTimeout(200);
  await agency.click(`text=${clientCompanyName}`);
  await agency.waitForTimeout(300);
  let agencyPanel = agency.locator("div.fixed.inset-0.z-30").last();
  await agencyPanel.getByRole("button", { name: "スタッフ一覧" }).click();
  await agency.waitForTimeout(200);
  let agencyPanelBody = await agencyPanel.textContent();
  log("④ オーナー側からも同じ配属解除が見える", agencyPanelBody.includes("配属中のスタッフはいません"));

  // --- ⑤ re-assign reactivates the SAME row (not a new one) ---
  await agency.goto("http://localhost:3000/company/calendar");
  await agency.locator("button", { hasText: "＋" }).last().click();
  await agency.getByText("シフトを作成").click();
  const modal2 = agency.locator("div.fixed.inset-0.z-20").last();
  if (await modal2.getByText("どのチームのシフトを作成しますか？").count()) {
    await modal2.getByRole("button").first().click();
    await agency.waitForTimeout(200);
  }
  await modal2.getByRole("button", { name: clientCompanyName }).click();
  await modal2.getByRole("button", { name: "両方向確認業務" }).click();
  await agency.waitForTimeout(300);
  // スタッフを選ぶとdatetimeステップに直接進む（staff選択ボタン自体が
  // goNext()を呼ぶ）ので、この時点で日付を変える。同じ日に1件目のシフトが
  // 既にあるので重複扱いになる — 今日を選択解除して翌日を選択する。
  await modal2.getByRole("button", { name: "両方向確認スタッフ" }).click();
  await agency.waitForTimeout(300);
  // アプリの「今日」はJST基準（date.tsのtodayJst参照）。実行環境のローカル
  // 時刻でnew Date().getDate()すると、UTC 15〜23時台はJSTと日付がずれて
  // 「今日」ボタンが無効(過去)扱いになることがあるので、JST基準で計算する。
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const todayJst = new Date(Date.now() + JST_OFFSET_MS);
  const tomorrowJst = new Date(Date.now() + JST_OFFSET_MS + 86400000);
  await modal2.getByRole("button", { name: String(todayJst.getUTCDate()), exact: true }).click();
  await modal2.getByRole("button", { name: String(tomorrowJst.getUTCDate()), exact: true }).click();
  await agency.waitForTimeout(200);
  await modal2.getByRole("button", { name: "次へ" }).click();
  await agency.waitForTimeout(300);
  await modal2.getByRole("button", { name: /件のシフトを作成/ }).click();
  await agency.waitForTimeout(800);

  const placementRowCount = psql(`select count(*) from "StaffPlacement" where "companyRelationshipId"='${relId}';`);
  log("⑤ 再配属は同じ行を再利用する（重複行は作られない）", placementRowCount === "1");
  const placementRowAfterReassign = psql(`select id, active, "endedAt" from "StaffPlacement" where "companyRelationshipId"='${relId}';`);
  log("⑤ 再配属で同じ行がactive=trueに戻る", placementRowAfterReassign.startsWith(`${placementId}|t|`));

  console.log(process.exitCode ? "RELATIONSHIP BIDIRECTIONAL SMOKE TEST HAD FAILURES" : "RELATIONSHIP BIDIRECTIONAL SMOKE TEST PASSED");
} catch (err) {
  console.error("RELATIONSHIP BIDIRECTIONAL SMOKE TEST FAILED", err);
  await agency.screenshot({ path: "/tmp/smoke-relationship-bidirectional-agency-failure.png" });
  await client.screenshot({ path: "/tmp/smoke-relationship-bidirectional-client-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
