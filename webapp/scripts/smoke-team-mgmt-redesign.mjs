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

// 設定＞チーム管理の再設計の検証:
// - 「＋チームを作成」がポップアップになり、任意で担当者を同時に割り当てられる
// - チームのメンバー一覧が本部メンバーと同じ列（氏名/メール/権限/権限を外す）になった
// - 本部メンバーにも「権限を外す」が付き、STAFFへ降格される（会社からは消えない）
// - 本部管理者が1名しかいない場合は「権限を外す」が拒否される
// - チーム/本部どちらの「権限を外す」も、クリックしただけでは実行されず、
//   確認ダイアログを挟んでからでないと実行されない（キャンセルすると何も
//   起きない）

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();

const adminEmail = `tmr-admin-${Date.now()}@example.com`;
const editorEmail = `tmr-editor-${Date.now()}@example.com`;
const companyName = `チーム管理再設計確認株式会社${Date.now()}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "チーム管理再設計確認管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  // --- スタッフを1名作成しておく（チーム作成時の担当者割り当て用） ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "担当予定スタッフ");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  // サーバーアクションの完了（DBコミット）を待つ — 固定sleepだと開発サーバー
  // が重い時にレースしてチーム作成ポップアップの担当者選択肢に間に合わない
  // ことがあったため、実際にDBへ現れるまでポーリングする。
  for (let i = 0; i < 20; i++) {
    if (psql(`select count(*) from "User" where name='担当予定スタッフ';`) !== "0") break;
    await admin.waitForTimeout(300);
  }

  // --- チーム管理: 「＋チームを作成」がポップアップになっている ---
  await admin.goto("http://localhost:3000/company/settings?tab=basic");
  let bodyText = await admin.textContent("body");
  log("常時表示の「新しいチーム名」入力欄はもう無い", !bodyText.includes("新しいチーム名"));

  await admin.getByRole("button", { name: "＋チームを作成" }).click();
  await admin.waitForTimeout(300);
  bodyText = await admin.textContent("body");
  log("ポップアップに担当者（任意）の割り当て欄がある", bodyText.includes("担当者（任意）"));

  const modal = admin.locator("div.fixed.inset-0.z-30").last();
  await modal.locator('input[placeholder="新しいチーム名"]').fill("再設計確認チーム");
  await modal.locator("select").first().selectOption({ label: "担当予定スタッフ" });
  await admin.waitForTimeout(200);
  await modal.locator("select").nth(1).selectOption({ label: "リーダー" });
  await modal.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);

  const teamId = psql(`select id from "Team" where "companyId"='${companyId}' and name='再設計確認チーム';`);
  log("チームがポップアップから作成された", Boolean(teamId));
  const assignedRole = psql(
    `select tm.role from "TeamMembership" tm join "User" u on u.id = tm."userId" where tm."teamId"='${teamId}' and u.name='担当予定スタッフ';`,
  );
  log("同時に指定した担当者がリーダーとして割り当てられた", assignedRole === "TEAM_LEADER");
  const proxyStaffEmail = psql(`select email from "User" where name='担当予定スタッフ' order by "createdAt" desc limit 1;`);

  // --- チームのメンバー一覧が本部メンバーと同じ列構成になっている ---
  await admin.reload();
  await admin.waitForTimeout(300);
  const teamCardText = await admin.locator("div.rounded-xl.border.border-border", { hasText: "再設計確認チーム" }).first().textContent();
  log("チームカード内にメール列が表示されている", teamCardText.includes("メール"));
  log("チームカード内に担当予定スタッフのメールが表示されている", teamCardText.includes(proxyStaffEmail));
  log("チームカード内に権限を外す列がある", teamCardText.includes("権限を外す"));

  // --- チーム側「権限を外す」: クリックしただけでは実行されず、確認ダイアログを挟む ---
  const teamCard = admin.locator("div.rounded-xl.border.border-border", { hasText: "再設計確認チーム" }).first();
  await teamCard.getByRole("button", { name: "権限を外す" }).click();
  await admin.waitForTimeout(300);
  let dialogText = await admin.textContent("body");
  log("チーム側「権限を外す」クリックで確認ダイアログが出る", dialogText.includes("チーム管理者/リーダー権限を外します"));

  // キャンセルすると何も変わらない
  await admin.getByRole("button", { name: "キャンセル" }).click();
  await admin.waitForTimeout(300);
  const roleAfterCancel = psql(
    `select role from "TeamMembership" tm join "User" u on u.id = tm."userId" where tm."teamId"='${teamId}' and u.name='担当予定スタッフ';`,
  );
  log("チーム側: キャンセルすると権限は変わらない", roleAfterCancel === "TEAM_LEADER");

  // 改めて実行し、確認ダイアログの「権限を外す」を押すと実行される
  await teamCard.getByRole("button", { name: "権限を外す" }).click();
  await admin.waitForTimeout(300);
  const teamConfirmDialog = admin.locator("div.fixed.inset-0.z-40").last();
  await teamConfirmDialog.getByRole("button", { name: "権限を外す" }).click();
  await admin.waitForTimeout(500);
  const roleAfterConfirm = psql(
    `select role from "TeamMembership" tm join "User" u on u.id = tm."userId" where tm."teamId"='${teamId}' and u.name='担当予定スタッフ';`,
  );
  log("チーム側: 確認ダイアログで確定すると権限が外れる（TEAM_MEMBERに戻る）", roleAfterConfirm === "TEAM_MEMBER");

  // --- 本部メンバーに「権限を外す」があり、編集者は降格できる ---
  await admin.getByRole("button", { name: "＋招待" }).first().click();
  await admin.waitForTimeout(400);
  const inviteLineText = await admin.locator("p", { hasText: "招待URL:" }).textContent();
  const editorInviteUrl = inviteLineText?.replace("招待URL:", "").trim() ?? null;

  const editorCtx = await browser.newContext();
  const editor = await editorCtx.newPage();
  await editor.goto(editorInviteUrl);
  await editor.click("text=アカウントを作成して参加する");
  await editor.fill("#name", "降格確認編集者");
  await editor.fill("#email", editorEmail);
  await editor.fill("#password", "password123");
  await editor.click("button[type=submit]");
  await editor.waitForURL(/\/invite\//, { timeout: 10000 });
  await editor.click("text=参加する");
  await editor.waitForURL("http://localhost:3000/company", { timeout: 10000 });
  await editorCtx.close();

  await admin.goto("http://localhost:3000/company/settings?tab=basic");
  await admin.waitForTimeout(300);
  let adminsSection = admin.locator("section", { hasText: "本部メンバー権限" });
  let editorRow = adminsSection.locator("tr", { hasText: "降格確認編集者" });
  await editorRow.getByRole("button", { name: "権限を外す" }).click();
  await admin.waitForTimeout(300);

  let dialogBodyText = await admin.textContent("body");
  log("本部側「権限を外す」クリックで確認ダイアログが出る", dialogBodyText.includes("本部管理者/編集者権限を外し"));

  const editorUserId = psql(`select id from "User" where email='${editorEmail}';`);

  // キャンセルすると何も変わらない
  await admin.getByRole("button", { name: "キャンセル" }).click();
  await admin.waitForTimeout(300);
  const editorRoleAfterCancel = psql(
    `select role from "CompanyMembership" where "companyId"='${companyId}' and "userId"='${editorUserId}';`,
  );
  log("本部側: キャンセルすると権限は変わらない", editorRoleAfterCancel === "COMPANY_EDITOR");

  // 改めて実行し、確認ダイアログの「権限を外す」を押すと実行される
  adminsSection = admin.locator("section", { hasText: "本部メンバー権限" });
  editorRow = adminsSection.locator("tr", { hasText: "降格確認編集者" });
  await editorRow.getByRole("button", { name: "権限を外す" }).click();
  await admin.waitForTimeout(300);
  const adminConfirmDialog = admin.locator("div.fixed.inset-0.z-40").last();
  await adminConfirmDialog.getByRole("button", { name: "権限を外す" }).click();
  await admin.waitForTimeout(500);

  const editorMembershipRole = psql(
    `select role from "CompanyMembership" where "companyId"='${companyId}' and "userId"='${editorUserId}';`,
  );
  log("確認ダイアログで確定すると編集者がSTAFFへ降格される", editorMembershipRole === "STAFF");
  const membershipStillExists = Number(
    psql(`select count(*) from "CompanyMembership" where "companyId"='${companyId}' and "userId"='${editorUserId}';`),
  );
  log("会社からは削除されず所属は残る", membershipStillExists === 1);

  await admin.reload();
  await admin.waitForTimeout(300);
  const adminsSectionText = await admin.locator("section", { hasText: "本部メンバー権限" }).textContent();
  log("降格後は本部メンバー一覧から消える", !adminsSectionText.includes("降格確認編集者"));

  // --- 本部管理者が1名だけの場合は「権限を外す」が拒否される ---
  adminsSection = admin.locator("section", { hasText: "本部メンバー権限" });
  const soleAdminRow = adminsSection.locator("tr", { hasText: "チーム管理再設計確認管理者" });
  const removeButton = soleAdminRow.getByRole("button", { name: "権限を外す" });
  log("唯一の本部管理者は「権限を外す」ボタンが無効", await removeButton.isDisabled());

  console.log(process.exitCode ? "TEAM MGMT REDESIGN SMOKE TEST HAD FAILURES" : "TEAM MGMT REDESIGN SMOKE TEST PASSED");
} catch (err) {
  console.error("TEAM MGMT REDESIGN SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-tmr-admin-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
