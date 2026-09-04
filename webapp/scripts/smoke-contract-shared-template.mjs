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

const adminEmail = `sharedtpl-admin-${Date.now()}@example.com`;

async function createProxyStaff(name) {
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=仮アカウントを作成");
  await admin.locator('input[type=text]').last().fill(name);
  await admin.getByRole("button", { name: "作成" }).click();
  await admin.waitForTimeout(800);
}

async function openGenerateFlow(staffName) {
  await admin.goto("http://localhost:3000/company/roster");
  await admin.reload();
  await admin.waitForTimeout(500);
  await admin.locator("tbody tr", { hasText: staffName }).click();
  await admin.waitForTimeout(300);
  const panel = admin.locator("div.fixed.inset-0.z-30").first();
  await panel.getByRole("button", { name: "契約書管理" }).click();
  await panel.getByRole("button", { name: "＋契約書を生成" }).click();
  await admin.waitForTimeout(200);
  const choose = admin.locator("div.fixed.inset-0.z-30").last();
  await choose.locator("select").selectOption({ label: "アルバイト・キャディ業務" });
  await choose.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  return panel;
}

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "テンプレ共有管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "テンプレ共有株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='テンプレ共有株式会社' order by "createdAt" desc limit 1;`);

  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("キャディ業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("DAILY");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("9000");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);
  const templateId = psql(`select id from "ContractTemplate" where "companyId"='${companyId}' order by "createdAt" desc limit 1;`);

  await createProxyStaff("共有太郎");
  await createProxyStaff("共有花子");
  await createProxyStaff("編集次郎");

  // --- staff 1: そのまま契約する
  await openGenerateFlow("共有太郎");
  let body = await admin.textContent("body");
  log("テンプレート選択後、割り当てか編集かの選択画面が出る", body.includes("このテンプレートのまま契約する") && body.includes("内容を編集して専用の契約書を作る"));
  await admin.getByRole("button", { name: "このテンプレートのまま契約する" }).click();
  await admin.waitForTimeout(700);

  const templateCountAfter1 = psql(`select count(*) from "ContractTemplate" where "companyId"='${companyId}';`);
  log("「そのまま契約する」ではテンプレートが複製されない（1件のまま）", templateCountAfter1 === "1");

  const contract1TemplateId = psql(
    `select sc."templateId" from "StaffContract" sc ` +
      `join "User" u on u.id=sc."staffUserId" ` +
      `join "CompanyMembership" cm on cm."userId"=u.id ` +
      `where u.name='共有太郎' and cm."companyId"='${companyId}' order by sc."createdAt" desc limit 1;`,
  );
  log("生成された契約が元のテンプレートを直接参照している", contract1TemplateId === templateId);

  // --- staff 2: 同じテンプレートをそのまま共有
  await openGenerateFlow("共有花子");
  await admin.getByRole("button", { name: "このテンプレートのまま契約する" }).click();
  await admin.waitForTimeout(700);

  const templateCountAfter2 = psql(`select count(*) from "ContractTemplate" where "companyId"='${companyId}';`);
  log("2人目も同じテンプレートを共有できる（テンプレートはまだ1件のまま）", templateCountAfter2 === "1");

  const sharedContractCount = psql(`select count(*) from "StaffContract" where "templateId"='${templateId}';`);
  log("1つのテンプレートに2件の契約がぶら下がっている", sharedContractCount === "2");

  // --- 設定画面: 契約中の▼一覧に両方の名前が出る
  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  body = await admin.textContent("body");
  log("契約中（2件）の▼トグルが表示される", body.includes("契約中（2件）"));
  log("開く前は名前が見えていない", !body.includes("共有太郎、共有花子") && !body.includes("共有花子、共有太郎"));

  await admin.getByRole("button", { name: /契約中（2件）/ }).click();
  await admin.waitForTimeout(200);
  body = await admin.textContent("body");
  log("▼を開くと両方の名前が表示される", body.includes("共有太郎") && body.includes("共有花子"));

  // --- staff 3: 内容を編集して専用の契約書を作る（従来通り複製）
  await openGenerateFlow("編集次郎");
  await admin.getByRole("button", { name: "内容を編集して専用の契約書を作る" }).click();
  await admin.waitForTimeout(300);
  body = await admin.textContent("body");
  log("「内容を編集して」を選ぶと従来通りの編集フォームが開く", body.includes("編集次郎様"));
  await admin.getByRole("button", { name: "生成する" }).click();
  await admin.waitForTimeout(700);

  const templateCountAfter3 = psql(`select count(*) from "ContractTemplate" where "companyId"='${companyId}';`);
  log("「内容を編集して」を選んだ場合だけ複製が作られる（テンプレート2件に）", templateCountAfter3 === "2");

  const contract3TemplateId = psql(
    `select sc."templateId" from "StaffContract" sc ` +
      `join "User" u on u.id=sc."staffUserId" ` +
      `join "CompanyMembership" cm on cm."userId"=u.id ` +
      `where u.name='編集次郎' and cm."companyId"='${companyId}' order by sc."createdAt" desc limit 1;`,
  );
  log("編集次郎の契約は元のテンプレートとは別の複製を参照している", contract3TemplateId !== templateId);

  // --- 元のテンプレートはLOCKEDでも引き続き選択肢に残る（4人目にも共有できる）
  await createProxyStaff("共有三郎");
  await admin.goto("http://localhost:3000/company/roster");
  await admin.reload();
  await admin.waitForTimeout(500);
  await admin.locator("tbody tr", { hasText: "共有三郎" }).click();
  await admin.waitForTimeout(300);
  const panel4 = admin.locator("div.fixed.inset-0.z-30").first();
  await panel4.getByRole("button", { name: "契約書管理" }).click();
  await panel4.getByRole("button", { name: "＋契約書を生成" }).click();
  await admin.waitForTimeout(200);
  const choose4Options = await admin.locator("div.fixed.inset-0.z-30").last().locator("select option").allTextContents();
  log(
    "LOCKED状態でも元テンプレートが選択肢に残っている（3人目以降にも共有できる）",
    choose4Options.some((o) => o.includes("キャディ業務") && !o.includes("様")),
  );

  console.log(process.exitCode ? "SHARED TEMPLATE SMOKE TEST HAD FAILURES" : "SHARED TEMPLATE SMOKE TEST PASSED");
} catch (err) {
  console.error("SHARED TEMPLATE SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-shared-template-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
