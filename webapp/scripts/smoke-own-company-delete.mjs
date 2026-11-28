import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// スタッフとして招待された人が、自分でも会社を作ってしまった時：
// ・会社を作る画面に「スタッフとして働く方」の案内が出る
// ・招待URLから登録し直そうとして「既に登録されています」になると「ログインして参加する」が出て、招待に参加できる
// ・まだ何も使っていない自分の会社は、設定＞基本情報の「この会社を削除」で消せ、スタッフの画面へ移る
// ・使っている会社（スタッフがいる等）には削除が出ない

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
function latestMagicLink(fromOffset) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const matches = [...readFileSync("/tmp/nextdev.log", "utf8").slice(fromOffset).matchAll(/\/magic-link\/([A-Za-z0-9_-]+)/g)];
    if (matches.length) return `http://localhost:3000/magic-link/${matches[matches.length - 1][1]}`;
    execSync("sleep 0.2");
  }
  throw new Error("magic link not found");
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const owner = await (await browser.newContext()).newPage();
const person = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
person.on("dialog", (d) => d.accept());
const suffix = Date.now();
const personEmail = `ocd-person-${suffix}@example.com`;

try {
  // 所属先の会社
  await owner.goto("http://localhost:3000/register");
  await owner.fill("#name", "所属先担当");
  await owner.fill("#email", `ocd-owner-${suffix}@example.com`);
  await owner.click("button[type=submit]");
  await owner.waitForTimeout(400);
  await owner.goto(extractMagicLinkFromLog());
  await owner.waitForURL("http://localhost:3000/register/company");
  await owner.fill("#name", `所属先株式会社${suffix}`);
  await owner.click("button[type=submit]");
  await owner.waitForURL("http://localhost:3000/company");
  log("会社として使う人は、そのまま会社を作れる", true);
  const ownerCompanyId = psql(`select id from "Company" where name='所属先株式会社${suffix}';`);

  // 本人：招待URLではなく、普通の登録から入ってしまう
  await person.goto("http://localhost:3000/register");
  log("登録画面に「スタッフは招待URLから」の案内が出る", (await person.getByTestId("register-staff-note").count()) === 1);
  await person.fill("#name", "神出テスト");
  await person.fill("#email", personEmail);
  await person.click("button[type=submit]");
  await person.waitForTimeout(400);
  await person.goto(extractMagicLinkFromLog());
  await person.waitForURL("http://localhost:3000/register/company");
  log("会社を作る画面に「スタッフとして働く方」の案内が出る", (await person.getByTestId("staff-guide").count()) === 1);
  // 案内を読まずに会社を作ってしまう
  await person.fill("#name", `間違え会社${suffix}`);
  await person.click("button[type=submit]");
  await person.waitForURL("http://localhost:3000/company");
  const wrongCompanyId = psql(`select id from "Company" where name='間違え会社${suffix}';`);

  // 所属先が招待URLを送る
  await owner.goto("http://localhost:3000/company/roster");
  await owner.getByText("＋スタッフを追加").first().click();
  await owner.click("text=本アカウントを招待");
  await owner.getByRole("button", { name: "招待URLを発行する" }).click();
  await owner.waitForSelector("input[readonly]");
  const inviteUrl = await owner.locator("input[readonly]").inputValue();

  // 本人：ログアウトした状態で招待URLを開き、「アカウントを作成」から登録しようとする
  await person.context().clearCookies();
  await person.goto(inviteUrl);
  await person.click("text=アカウントを作成して参加する");
  await person.fill("#name", "神出テスト");
  await person.fill("#email", personEmail);
  await person.click("button[type=submit]");
  const box = person.getByTestId("already-registered");
  await box.waitFor();
  log("既に登録済みなら「ログインして参加する」が出る", (await box.getByRole("link", { name: "ログインして参加する" }).count()) === 1);
  await box.getByRole("link", { name: "ログインして参加する" }).click();
  await person.waitForURL(/\/login/);
  const offset = readFileSync("/tmp/nextdev.log", "utf8").length;
  await person.fill("#email", personEmail);
  await person.click("button[type=submit]");
  await person.getByText("ログイン用のメールを送信しました").waitFor();
  await person.goto(latestMagicLink(offset));
  await person.waitForURL(/\/invite\//, { timeout: 15000 });
  await person.click("text=参加する");
  await person.waitForURL((u) => u.pathname === "/staff" || u.pathname === "/company" || u.pathname === "/home", { timeout: 15000 });
  const personId = psql(`select id from "User" where email='${personEmail}';`);
  log(
    "ログインして招待に参加できる（所属先のスタッフになる）",
    psql(`select role from "CompanyMembership" where "userId"='${personId}' and "companyId"='${ownerCompanyId}';`) === "STAFF",
  );

  // 間違えて作った会社の画面で、設定＞基本情報の「この会社を削除」
  await person.context().addCookies([{ name: "active_company_id", value: wrongCompanyId, url: "http://localhost:3000" }]);
  await person.goto("http://localhost:3000/company/settings?tab=basic");
  const section = person.getByTestId("delete-own-company");
  await section.waitFor({ timeout: 15000 });
  await section.getByRole("button", { name: "この会社を削除する" }).click();
  await person.getByRole("button", { name: "削除する", exact: true }).click();
  await person.waitForURL("http://localhost:3000/staff", { timeout: 15000 });
  log("まだ何も使っていない自分の会社を削除でき、スタッフの画面に移る", psql(`select count(*) from "Company" where id='${wrongCompanyId}';`) === "0");
  await person.goto("http://localhost:3000/home");
  await person.waitForURL("http://localhost:3000/staff", { timeout: 15000 });
  log("次からもスタッフの画面で開く", person.url().endsWith("/staff"));

  // スタッフがいる会社には削除が出ない
  await owner.goto("http://localhost:3000/company/settings?tab=basic");
  await owner.waitForTimeout(1500);
  log("スタッフがいる会社には「この会社を削除」が出ない", (await owner.getByTestId("delete-own-company").count()) === 0);

  console.log(process.exitCode ? "OWN COMPANY DELETE SMOKE TEST HAD FAILURES" : "OWN COMPANY DELETE SMOKE TEST PASSED");
} catch (err) {
  console.error("OWN COMPANY DELETE SMOKE TEST FAILED", err);
  await person.screenshot({ path: "/tmp/smoke-own-company-delete-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
