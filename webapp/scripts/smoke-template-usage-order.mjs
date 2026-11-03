import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 名簿の「スタッフを招待」のテンプレートの選択肢が、使っている順に並ぶ：
// 契約中（確認待ちを含む）の人数が多い順 → 同じなら最近使った順 → 新しい順

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
const suffix = Date.now();
const companyName = `テンプレ順確認株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "テンプレ順本部");
  await admin.fill("#email", `template-order-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("受付業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("1200");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);
  const baseId = psql(`select id from "ContractTemplate" where "companyId"='${companyId}' limit 1;`);
  psql(`update "ContractTemplate" set title='テンプレ0人（一番新しい）', "createdAt"=now() where id='${baseId}';`);

  // 複製して、使っている人数・使った時期の違うテンプレートを作る
  const cols = psql(
    `select string_agg(quote_ident(column_name), ',') from information_schema.columns where table_name='ContractTemplate' and column_name not in ('id','title','createdAt');`,
  );
  const copy = (title, daysAgo) =>
    psql(
      `with ins as (insert into "ContractTemplate" (id, title, "createdAt", ${cols}) select gen_random_uuid()::text, '${title}', now() - interval '${daysAgo} days', ${cols} from "ContractTemplate" where id='${baseId}' returning id) select id from ins;`,
    );
  const two = copy("テンプレ2人", 30);
  const oneOld = copy("テンプレ1人（前に使用）", 20);
  const oneNew = copy("テンプレ1人（最近使用）", 25);
  const ended = copy("テンプレ終了のみ", 10);
  const contract = (templateId, status, daysAgo) => {
    const userId = psql(
      `with ins as (insert into "User" (id, email, name, "createdAt", "updatedAt") values (gen_random_uuid()::text, 'tpl-${suffix}-' || floor(random()*1e9)::text || '@example.com', 'テンプレ順スタッフ', now(), now()) returning id) select id from ins;`,
    );
    psql(
      `insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", status, "createdAt", "updatedAt") values (gen_random_uuid()::text, '${templateId}', '${userId}', 1200, '${status}', now() - interval '${daysAgo} days', now());`,
    );
  };
  contract(two, "ACTIVE", 15);
  contract(two, "PENDING_CONSENT", 14);
  contract(oneOld, "ACTIVE", 9);
  contract(oneNew, "ACTIVE", 2);
  contract(ended, "ENDED", 1);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=本アカウントを招待");
  const select = admin.locator(`select:has(option[value="${baseId}"])`);
  const options = (await select.locator("option").allTextContents()).filter((t) => t.startsWith("テンプレ"));
  console.log(options.join(" / "));
  log(
    "使っている人数が多い順 → 最近使った順 → 新しい順に並ぶ",
    JSON.stringify(options) ===
      JSON.stringify(["テンプレ2人", "テンプレ1人（最近使用）", "テンプレ1人（前に使用）", "テンプレ終了のみ", "テンプレ0人（一番新しい）"]),
  );

  console.log(process.exitCode ? "TEMPLATE USAGE ORDER SMOKE TEST HAD FAILURES" : "TEMPLATE USAGE ORDER SMOKE TEST PASSED");
} catch (err) {
  console.error("TEMPLATE USAGE ORDER SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
