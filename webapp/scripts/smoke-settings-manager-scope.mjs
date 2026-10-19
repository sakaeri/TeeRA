import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// チームマネージャーが設定画面を開いたときの表示範囲を検証する：
// ・会社情報は会社名・住所・電話番号だけ（口座・インボイス番号は出さない）
// ・本部メンバー、他のチーム、契約関連タブ、他チームの業務報告は出さない
// ・自分のチームのマネージャー/リーダーは変更できる（自分自身は変えられない）

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`)
    .toString()
    .split("\n")
    .filter((line) => !/^(INSERT|UPDATE|DELETE)\s/.test(line))
    .join("\n")
    .trim();
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();
const manager = await (await browser.newContext()).newPage();
const suffix = Date.now();
const companyName = `設定範囲確認株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "設定範囲本部");
  await admin.fill("#email", `scope-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  psql(
    `update "Company" set address='東京都千代田区1-1', "phoneNumber"='03-0000-0000', "bankName"='テスト銀行', "accountNumber"='1234567', "invoiceRegistrationNumber"='T1234567890123' where id='${companyId}';`,
  );

  const team = (name) =>
    psql(`with ins as (insert into "Team" (id, "companyId", name) values (gen_random_uuid()::text, '${companyId}', '${name}') returning id) select id from ins;`);
  const teamA = team("範囲Aチーム");
  const teamB = team("範囲Bチーム");
  // ログイン時にメールアドレスは小文字化されるため、メールは小文字の英数字にする
  const user = (key, name, teamId, role) => {
    const id = psql(
      `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, 'scope-${key}-${suffix}@example.com', 'x', '${name}', now()) returning id) select id from ins;`,
    );
    psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${id}', '${companyId}', 'STAFF');`);
    psql(`insert into "TeamMembership" (id, "teamId", "userId", role) values (gen_random_uuid()::text, '${teamId}', '${id}', '${role}');`);
    return id;
  };
  const managerId = user("amanager", "Aマネージャー", teamA, "TEAM_MANAGER");
  const leaderId = user("aleader", "Aリーダー", teamA, "TEAM_LEADER");
  user("bmanager", "Bマネージャー", teamB, "TEAM_MANAGER");

  // 業務報告（Aチーム・Bチームの承認待ちを1件ずつ）
  const pendingReport = (staffId, teamId, task) => {
    const shiftId = psql(
      `with ins as (insert into "Shift" (id, "companyId", "staffUserId", "teamId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', '${teamId}', 'INHOUSE', '${task}', current_date - 1, '09:00', '12:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
    );
    psql(
      `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "computedMinutes", "submittedAt", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${shiftId}', '${staffId}', 'WORKED', 'PENDING', 180, now(), now(), now());`,
    );
  };
  pendingReport(leaderId, teamA, "A業務");
  pendingReport(psql(`select "userId" from "TeamMembership" where "teamId"='${teamB}' limit 1;`), teamB, "B業務");

  // --- マネージャーとしてログイン ---
  // パスワード "password123" のbcryptハッシュ（psqlはシェル経由なので$をエスケープ）
  psql(`update "User" set "passwordHash"='\\$2b\\$10\\$/mEEG3MjInUs/GTnDFsVM./2.GDR18u06dgvlLCPnc1Xz2kVQRLga' where id='${managerId}';`);
  await manager.goto("http://localhost:3000/login");
  await manager.fill("#email", `scope-amanager-${suffix}@example.com`);
  await manager.fill("#password", "password123");
  await manager.click("button[type=submit]");
  await manager.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10000 });
  await manager.goto("http://localhost:3000/company/settings");
  await manager.waitForTimeout(800);
  const body = await manager.locator("main").innerText();
  log("会社名・住所・電話番号は見える", body.includes(companyName) && body.includes("東京都千代田区1-1") && body.includes("03-0000-0000"));
  log("口座・インボイス番号は見えない", !body.includes("テスト銀行") && !body.includes("1234567") && !body.includes("T1234567890123"));
  log("本部メンバーは見えない", !body.includes("設定範囲本部"));
  log("自分のチームは見えて、他のチームは見えない", body.includes("範囲Aチーム") && !body.includes("範囲Bチーム") && !body.includes("Bマネージャー"));
  log("チームの作成ボタンは出ない", (await manager.getByRole("button", { name: "＋チームを作成" }).count()) === 0);
  log("契約関連タブは出ない", (await manager.getByRole("button", { name: "契約関連" }).count()) === 0);

  // --- 自チームの役職変更（自分自身は不可） ---
  const teamCard = manager.locator("div.rounded-xl.border.border-border.p-4").first();
  const rows = teamCard.locator("table tbody tr");
  const ownRowSelect = rows.filter({ hasText: "Aマネージャー" }).locator("select");
  log("自分自身の役職は変えられない", await ownRowSelect.isDisabled());
  await rows.filter({ hasText: "Aリーダー" }).locator("select").selectOption("TEAM_MANAGER");
  await manager.waitForTimeout(800);
  log(
    "自チームのリーダーをマネージャーに変えられる",
    psql(`select role from "TeamMembership" where "teamId"='${teamA}' and "userId"='${leaderId}';`) === "TEAM_MANAGER",
  );
  log("＋招待ボタンが使える", (await teamCard.getByRole("button", { name: "＋招待" }).count()) === 1);

  // --- 業務報告タブは自チームの分だけ ---
  await manager.goto("http://localhost:3000/company/settings?tab=workreports");
  await manager.waitForTimeout(800);
  const reportsText = await manager.locator("main").innerText();
  log("業務報告は自チームの分だけ", reportsText.includes("A業務") && !reportsText.includes("B業務"));

  // --- 本部は今まで通り全部見える ---
  await admin.goto("http://localhost:3000/company/settings");
  await admin.waitForTimeout(800);
  const adminBody = await admin.locator("main").innerText();
  log("本部は口座・全チームが見える", adminBody.includes("テスト銀行") && adminBody.includes("範囲Bチーム"));

  console.log(process.exitCode ? "SETTINGS MANAGER SCOPE SMOKE TEST HAD FAILURES" : "SETTINGS MANAGER SCOPE SMOKE TEST PASSED");
} finally {
  await browser.close();
}
