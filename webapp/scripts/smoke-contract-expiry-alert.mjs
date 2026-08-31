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
const ctx = await browser.newContext();
const page = await ctx.newPage();
const email = `expiry-admin-${Date.now()}@example.com`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "満了管理者");
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", "契約満了テスト株式会社");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");

  const companyId = psql(
    `select cm."companyId" from "CompanyMembership" cm join "User" u on cm."userId"=u.id where u.email='${email}';`,
  );

  // ベーステンプレート（更新フローの選択肢として必要）
  psql(
    `insert into "ContractTemplate" (id, "companyId", title, "employmentType", "workplaceType", "jobDescription", ` +
      `"scheduleType", "wageType", "wageAmount", "contractPeriodType", "contractStartDate", status, "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', 'アルバイト・キャディ業務', 'PART_TIME', 'INHOUSE', 'キャディ業務', ` +
      `'SHIFT', 'DAILY', 9000, 'INDEFINITE', '2026-01-01', 'ACTIVE', now());`,
  );

  function seedStaffWithContract(label, name, endDateExpr) {
    const staffEmail = `expiry-${label}-${Date.now()}@example.com`;
    psql(
      `insert into "User" (id, email, "passwordHash", name, "updatedAt") ` +
        `values (gen_random_uuid()::text, '${staffEmail}', 'x', '${name}', now());`,
    );
    const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);
    psql(
      `insert into "CompanyMembership" (id, "companyId", "userId", role) ` +
        `values (gen_random_uuid()::text, '${companyId}', '${staffUserId}', 'STAFF');`,
    );
    const templateId = psql(
      `with ins as (insert into "ContractTemplate" (id, "companyId", title, "employmentType", "workplaceType", ` +
        `"jobDescription", "scheduleType", "wageType", "wageAmount", "contractPeriodType", "contractStartDate", ` +
        `"contractEndDate", status, "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${name}の契約', ` +
        `'PART_TIME', 'INHOUSE', 'キャディ業務', 'SHIFT', 'DAILY', 9000, 'FIXED_TERM', current_date - interval '30 day', ` +
        `${endDateExpr}, 'LOCKED', now()) returning id) select id from ins;`,
    );
    psql(
      `insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", "contractStartDate", ` +
        `"contractEndDate", status, "consentedAt", "updatedAt") values (gen_random_uuid()::text, '${templateId}', ` +
        `'${staffUserId}', 9000, current_date - interval '30 day', ${endDateExpr}, 'ACTIVE', now(), now());`,
    );
    return staffUserId;
  }

  // ① 5日後に満了 -> 対象（10日以内）
  const soonUserId = seedStaffWithContract("soon", "満了５日後太郎", "current_date + interval '5 day'");
  // ② 20日後に満了 -> 対象外（10日より先）
  seedStaffWithContract("far", "満了２０日後花子", "current_date + interval '20 day'");
  // ③ 2日前に満了済みだが status はまだ ACTIVE（未処理のまま放置）-> 対象外（消える）
  seedStaffWithContract("past", "満了済み次郎", "current_date - interval '2 day'");
  // ④ 期間の定めなし -> 対象外
  seedStaffWithContract("indef", "無期限三郎", "null");

  await page.goto("http://localhost:3000/company");
  let body = await page.textContent("body");
  log("契約満了間近 KPI shows exactly 1 (10日以内の1件のみ)", /契約満了間近[\s\S]{0,20}1/.test(body));
  log("統一やることリストにも契約満了の項目が出る", body.includes("満了") && body.includes("満了５日後太郎"));

  await page.getByText("契約満了間近", { exact: true }).click();
  await page.waitForTimeout(400);
  // ページ全体のbody.textContent()には、他のstate用にクライアントへ送られる
  // contractTemplates（他スタッフの契約書テンプレートのタイトルにも本人の
  // 名前が入っている）のハイドレーション用JSONも含まれてしまうため、
  // ポップアップの表示領域だけに絞って確認する。
  const popup = page.locator("div.fixed.inset-0.z-30").last();
  const popupText = await popup.textContent();
  log("ポップアップに対象スタッフ名と満了日が表示される", popupText.includes("満了５日後太郎"));
  log("20日後に満了する契約は対象外", !popupText.includes("満了２０日後花子"));
  log("既に満了日を過ぎた契約は一覧から消える", !popupText.includes("満了済み次郎"));
  log("期間の定めが無い契約は対象外", !popupText.includes("無期限三郎"));

  await page.getByRole("link", { name: "契約内容を確認" }).click();
  await page.waitForURL(new RegExp(`/company/roster\\?staff=${soonUserId}&tab=contracts`));
  await page.waitForTimeout(500);
  body = await page.textContent("body");
  log("「契約内容を確認」からスタッフ詳細の契約書管理タブへ直接遷移する", body.includes("満了５日後太郎") && body.includes("契約書管理"));
  log("契約書管理タブが開いた状態で表示される（現在の契約が見える）", body.includes("現在の契約"));

  await page.getByRole("button", { name: "＋契約書を生成" }).click();
  await page.waitForTimeout(200);
  await page.locator("select").last().selectOption({ label: "アルバイト・キャディ業務" });
  await page.getByRole("button", { name: "次へ" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "このテンプレートのまま契約する" }).click();
  await page.waitForTimeout(700);

  const totalCount = psql(`select count(*) from "StaffContract" where "staffUserId"='${soonUserId}';`);
  const newOnePending = psql(
    `select status from "StaffContract" where "staffUserId"='${soonUserId}' order by "createdAt" desc limit 1;`,
  );
  log(
    "そこから通常通り契約書を生成できる（新しい契約が追加される、本人の同意待ち）",
    totalCount === "2" && newOnePending === "PENDING_CONSENT",
  );

  console.log(process.exitCode ? "CONTRACT EXPIRY ALERT SMOKE TEST HAD FAILURES" : "CONTRACT EXPIRY ALERT SMOKE TEST PASSED");
} catch (err) {
  console.error("CONTRACT EXPIRY ALERT SMOKE TEST FAILED", err);
  await page.screenshot({ path: "/tmp/smoke-contract-expiry-alert-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
