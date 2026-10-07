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

// 検証対象:
// ①本人確認書類の差し替え履歴（古い画像が履歴として残る）
// ②本部からスタッフ氏名・住所・電話番号を編集できる
// ④チーム名を後から変更できる
// ⑤仮アカウント取引先の名称を変更できる（本アカウント連携後は不可）

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();

const adminEmail = `profile-admin-${Date.now()}@example.com`;
const companyName = `プロフィール確認株式会社${Date.now()}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "プロフィール確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}' order by "createdAt" desc limit 1;`);

  // --- ④ チーム名の変更 ---
  await admin.goto("http://localhost:3000/company/settings?tab=basic");
  await admin.getByRole("button", { name: "＋チームを作成" }).click();
  await admin.waitForTimeout(300);
  const createTeamModal = admin.locator("div.fixed.inset-0.z-30").last();
  await createTeamModal.getByPlaceholder("新しいチーム名").fill("初期チーム名");
  await createTeamModal.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);
  let bodyText = await admin.textContent("body");
  log("チームが作成される", bodyText.includes("初期チーム名"));

  const teamCard = admin.locator("div.rounded-xl.border.border-border.p-4").first();
  await teamCard.getByRole("button", { name: "チーム名・通知先を変更" }).click();
  await admin.waitForTimeout(200);
  await teamCard.locator('input[type="text"]').fill("変更後のチーム名");
  await teamCard.locator('input[type="email"]').fill("team-a@example.com");
  await teamCard.getByRole("button", { name: "保存", exact: true }).click();
  await admin.waitForTimeout(1200);
  bodyText = await admin.textContent("body");
  log("チーム名の変更がUIに反映される", bodyText.includes("変更後のチーム名") && !bodyText.includes("初期チーム名"));
  log("チームの通知先メアドがUIに反映される", bodyText.includes("team-a@example.com"));
  const teamName = psql(`select name, "notificationEmail" from "Team" where "companyId"='${companyId}' limit 1;`);
  log("チーム名・通知先の変更がDBに反映される", teamName === "変更後のチーム名|team-a@example.com");

  // --- ⑤ 仮アカウント取引先の名称変更 ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加する");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "初期取引先名");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);
  const relationshipId = psql(
    `select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' order by "createdAt" desc limit 1;`,
  );

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=初期取引先名");
  await admin.waitForTimeout(400);
  const clientPanel = admin.locator("div.fixed.inset-0.z-30").last();
  await clientPanel.getByRole("button", { name: "名称を変更" }).click();
  await admin.waitForTimeout(200);
  await clientPanel.locator("input[type=text]").first().fill("変更後の取引先名");
  await clientPanel.getByRole("button", { name: "保存", exact: true }).click();
  await admin.waitForTimeout(600);
  bodyText = await admin.textContent("body");
  log("仮アカウントの名称変更がUIに反映される", bodyText.includes("変更後の取引先名"));
  const proxyName = psql(`select "proxyName" from "CompanyRelationship" where id='${relationshipId}';`);
  log("仮アカウントの名称変更がDBに反映される", proxyName === "変更後の取引先名");

  // --- ②スタッフ氏名・住所・電話番号の編集、①本人確認書類の履歴 ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "田中");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);
  const staffUserId = psql(
    `select u.id from "User" u join "CompanyMembership" cm on cm."userId"=u.id where cm."companyId"='${companyId}' and u.name='田中' order by u."createdAt" desc limit 1;`,
  );
  log("氏名だけの仮スタッフが作成できる（①②の前提）", Boolean(staffUserId));

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=田中");
  await admin.waitForTimeout(400);
  const staffPanel = admin.locator("div.fixed.inset-0").last();
  await staffPanel.getByRole("button", { name: "氏名・連絡先を編集" }).click();
  await admin.waitForTimeout(200);
  const profileInputs = staffPanel.locator("input[type=text]");
  await profileInputs.nth(0).fill("田中 太郎");
  await staffPanel.getByLabel("住所").fill("東京都千代田区1-1-1");
  await staffPanel.getByLabel("電話番号").fill("090-1234-5678");
  await staffPanel.getByRole("button", { name: "保存", exact: true }).click();
  await admin.waitForTimeout(600);
  bodyText = await admin.textContent("body");
  log(
    "本部が編集した氏名・住所・電話番号がUIに反映される",
    bodyText.includes("田中 太郎") && bodyText.includes("東京都千代田区1-1-1") && bodyText.includes("090-1234-5678"),
  );
  const updatedName = psql(`select name, address, "phoneNumber" from "User" where id='${staffUserId}';`);
  log("DBにも反映される", updatedName === "田中 太郎|東京都千代田区1-1-1|090-1234-5678");

  // --- ①本人確認書類のアップロード履歴（差し替え前の画像が履歴に退避される） ---
  const membershipId = psql(
    `select id from "CompanyMembership" where "userId"='${staffUserId}' and "companyId"='${companyId}';`,
  );
  // 1枚目をDB直接挿入で仕込んでおく（＝これが「差し替え前」の提出済み画像）
  psql(`update "CompanyMembership" set "idDocumentFrontUrl"='https://example.com/old-id-front.jpg' where id='${membershipId}';`);

  // 実際のストレージには繋がず、/api/uploadだけ即座に固定URLを返すよう
  // モックして、本番のアップロードUI〜サーバーアクションの流れ
  // （updateMembershipIdDocument）をそのまま通して履歴退避を検証する。
  await admin.route("**/api/upload", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "https://example.com/new-id-front.jpg" }) }),
  );

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=田中 太郎");
  await admin.waitForTimeout(400);
  const staffPanel2 = admin.locator("div.fixed.inset-0").last();
  await staffPanel2.getByRole("button", { name: "契約書管理" }).click();
  await admin.waitForTimeout(300);
  await staffPanel2.getByRole("button", { name: "アップロード" }).click();
  await admin.waitForTimeout(200);
  const uploadModal = admin.locator("div.fixed.inset-0.z-40").last();
  await uploadModal.locator('input[type="file"]').first().setInputFiles({
    name: "id-front.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await admin.waitForTimeout(800);
  await admin.keyboard.press("Escape").catch(() => {});
  await admin.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await admin.waitForTimeout(400);

  const newUrl = psql(`select "idDocumentFrontUrl" from "CompanyMembership" where id='${membershipId}';`);
  log("新しい画像に差し替わる", newUrl === "https://example.com/new-id-front.jpg");
  const historyCount = Number(
    psql(`select count(*) from "IdDocumentUploadHistory" where "membershipId"='${membershipId}' and side='front';`),
  );
  log("差し替え前の画像が履歴テーブルに1件退避される", historyCount === 1);
  const historyUrl = psql(
    `select url from "IdDocumentUploadHistory" where "membershipId"='${membershipId}' and side='front' order by "createdAt" desc limit 1;`,
  );
  log("履歴に残るのは差し替え前（古い方）のURL", historyUrl === "https://example.com/old-id-front.jpg");

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=田中 太郎");
  await admin.waitForTimeout(400);
  await admin.getByRole("button", { name: "契約書管理" }).click();
  await admin.waitForTimeout(300);
  bodyText = await admin.textContent("body");
  log("過去の提出履歴リンクが表示される", bodyText.includes("過去の提出履歴（1件）"));
  await admin.getByRole("button", { name: /過去の提出履歴/ }).click();
  await admin.waitForTimeout(200);
  bodyText = await admin.textContent("body");
  log("履歴を開くと差し替え前の画像リンクが見える", bodyText.includes("表面／"));

  console.log(process.exitCode ? "PROFILE/TEAM/PROXY/IDDOC SMOKE TEST HAD FAILURES" : "PROFILE/TEAM/PROXY/IDDOC SMOKE TEST PASSED");
} catch (err) {
  console.error("PROFILE/TEAM/PROXY/IDDOC SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
