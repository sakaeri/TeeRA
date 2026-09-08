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

// 招待システムの矛盾点の検証（①チームマネージャーの仮アカウント関連は
// staff作成UI自体の別問題として保留 — ここでは②④のみ検証する）:
// ② 招待URLを発行し直すと古いURLが無効化される / 重複リンクを弾く
// ④ 本部メンバー招待を既存メンバーに誤って送った際のヒント文言

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();
const counterpartCtx = await browser.newContext();
const counterpart = await counterpartCtx.newPage();

const adminEmail = `icf-admin-${Date.now()}@example.com`;
const staffEmail = `icf-staff-${Date.now()}@example.com`;
const counterpartEmail = `icf-counterpart-${Date.now()}@example.com`;
const companyName = `招待整合性確認株式会社${Date.now()}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "招待整合性確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  // --- 既存スタッフ（④のヒント文言テスト用）を先に用意しておく ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const staffInviteUrl = await admin.locator('input[readonly]').inputValue();
  await staff.goto(staffInviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "招待整合性確認スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(/\/invite\//, { timeout: 10000 });
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff", { timeout: 10000 });

  // --- ② 同じ取引先向けに招待URLを発行し直すと古い方が無効化される ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加する");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "再発行確認取引先");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);
  const proxyClientRelId = psql(
    `select id from "CompanyRelationship" where "ownerCompanyId"='${companyId}' and "proxyName"='再発行確認取引先' order by "createdAt" desc limit 1;`,
  );

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=再発行確認取引先");
  await admin.waitForTimeout(300);
  let panel = admin.locator("div.fixed.inset-0.z-30").last();
  await panel.getByRole("button", { name: "本アカウントと連携する" }).click();
  await admin.waitForTimeout(400);
  const firstToken = psql(
    `select token from "InviteToken" where "companyRelationshipId"='${proxyClientRelId}' and "usedAt" is null;`,
  );
  log("1回目の招待URLが発行された", Boolean(firstToken));

  await admin.click("text=← 閉じる");
  await admin.waitForTimeout(200);
  await admin.reload();
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=再発行確認取引先");
  await admin.waitForTimeout(300);
  panel = admin.locator("div.fixed.inset-0.z-30").last();
  await panel.getByRole("button", { name: "本アカウントと連携する" }).click();
  await admin.waitForTimeout(400);
  const secondToken = psql(
    `select token from "InviteToken" where "companyRelationshipId"='${proxyClientRelId}' and "usedAt" is null;`,
  );
  log("2回目発行後も未使用トークンは1件だけ（古い方が無効化された）", secondToken !== firstToken);
  const tokenCountForRel = Number(
    psql(`select count(*) from "InviteToken" where "companyRelationshipId"='${proxyClientRelId}' and "usedAt" is null;`),
  );
  log("重複した未使用トークンが残っていない", tokenCountForRel === 1);

  // --- ② 新規「本アカウントを招待」を同じ相手が二重に受諾しても重複しない ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加する");
  await admin.waitForTimeout(200);
  await admin.click("text=本アカウントを招待");
  await admin.waitForTimeout(200);
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const newClientUrlA = await admin.locator('input[readonly]').inputValue();

  await counterpart.goto(newClientUrlA);
  await counterpart.click("text=アカウントを作成して参加する");
  await counterpart.fill("#name", "重複確認依頼主担当者");
  await counterpart.fill("#email", counterpartEmail);
  await counterpart.fill("#password", "password123");
  await counterpart.click("button[type=submit]");
  await counterpart.waitForURL(/\/register\/company\?invite=/);
  await counterpart.fill("#name", "重複確認依頼主株式会社");
  await counterpart.click("button[type=submit]");
  await counterpart.waitForURL(/\/invite\//);
  await counterpart.click("text=/として招待を受け取る/");
  await counterpart.waitForURL("http://localhost:3000/company/roster");

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加する");
  await admin.waitForTimeout(200);
  await admin.click("text=本アカウントを招待");
  await admin.waitForTimeout(200);
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const newClientUrlB = await admin.locator('input[readonly]').inputValue();

  await counterpart.goto(newClientUrlB);
  await counterpart.waitForTimeout(300);
  await counterpart.click("text=/として招待を受け取る/");
  await counterpart.waitForURL(/\/invite\/.*\?error=/, { timeout: 10000 });
  const dupErrorBody = await counterpart.textContent("body");
  log("既にリンク済みの相手が別の招待URLを受諾すると弾かれる", dupErrorBody.includes("すでに連携済みです"));

  const relCountToCounterpart = Number(
    psql(
      `select count(*) from "CompanyRelationship" cr join "Company" c on c.id = cr."clientCompanyId" where cr."ownerCompanyId"='${companyId}' and c.name='重複確認依頼主株式会社';`,
    ),
  );
  log("重複した関係行は作られていない（1件のみ）", relCountToCounterpart === 1);

  // --- ② 古い招待URL（相手が既にリンク済みの関係）を直接使うと横取りを拒否 ---
  const hijackerCtx = await browser.newContext();
  const hijacker = await hijackerCtx.newPage();
  const hijackerEmail = `icf-hijacker-${Date.now()}@example.com`;
  await hijacker.goto("http://localhost:3000/register");
  await hijacker.fill("#name", "横取り確認担当者");
  await hijacker.fill("#email", hijackerEmail);
  await hijacker.fill("#password", "password123");
  await hijacker.click("button[type=submit]");
  await hijacker.waitForURL("http://localhost:3000/register/company");
  await hijacker.fill("#name", "横取り確認株式会社");
  await hijacker.click("button[type=submit]");
  await hijacker.waitForURL("http://localhost:3000/company");

  const realClientRelId = psql(
    `select cr.id from "CompanyRelationship" cr join "Company" c on c.id = cr."clientCompanyId" where cr."ownerCompanyId"='${companyId}' and c.name='重複確認依頼主株式会社';`,
  );
  const staleToken = psql(`select md5(random()::text);`);
  psql(
    `insert into "InviteToken" (id, token, kind, "companyId", "companyRelationshipId", "createdByUserId", "expiresAt", "createdAt") ` +
      `values (gen_random_uuid()::text, '${staleToken}', 'CLIENT_UPGRADE', '${companyId}', '${realClientRelId}', ` +
      `(select id from "User" where email='${adminEmail}'), now() + interval '14 day', now());`,
  );

  await hijacker.goto(`http://localhost:3000/invite/${staleToken}`);
  await hijacker.waitForTimeout(300);
  await hijacker.click("text=/として招待を受け取る/");
  await hijacker.waitForURL(/\/invite\/.*\?error=/, { timeout: 10000 });
  const hijackErrorBody = await hijacker.textContent("body");
  log("既にリンク済みの関係を古い招待URLで横取りしようとすると拒否される", hijackErrorBody.includes("古く"));

  const relStillCounterpart = psql(
    `select c.name from "CompanyRelationship" cr join "Company" c on c.id = cr."clientCompanyId" where cr.id='${realClientRelId}';`,
  );
  log("関係は横取りされず元の相手のまま", relStillCounterpart === "重複確認依頼主株式会社");

  // --- ④ 本部メンバー招待を既存メンバーに送った場合のヒント文言 ---
  await admin.goto("http://localhost:3000/company/settings?tab=basic");
  await admin.getByRole("button", { name: "＋招待" }).click();
  await admin.waitForTimeout(400);
  const adminInviteUrl = await admin.locator('section:has-text("本部メンバー権限") input[readonly]').inputValue();
  log("本部メンバー招待URLが発行された", Boolean(adminInviteUrl?.startsWith("http://localhost:3000/invite/")));

  // 既にこの会社のスタッフである人が、誤ってこの招待を開く
  // （membershipAtThisCompanyが即trueになるので、ボタンすら出ず即座に
  // 案内文だけが表示される）
  await staff.goto(adminInviteUrl);
  await staff.waitForTimeout(300);
  const hintBody = await staff.textContent("body");
  log(
    "本部メンバー招待の重複エラーに、権限変更は設定画面から行う旨のヒントが出る",
    hintBody.includes("設定＞本部メンバー権限"),
  );

  console.log(process.exitCode ? "INVITE CONSISTENCY FIXES SMOKE TEST HAD FAILURES" : "INVITE CONSISTENCY FIXES SMOKE TEST PASSED");
} catch (err) {
  console.error("INVITE CONSISTENCY FIXES SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-icf-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-icf-staff-failure.png" });
  await counterpart.screenshot({ path: "/tmp/smoke-icf-counterpart-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
