import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";
import { waitForPageReady } from "./_lib/pageReady.mjs";

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

// 登録をパスワード入力なしのマジックリンク方式にした一連の変更の検証。
// パスワードは任意（アカウント設定から設定/削除）で、設定済みの人は
// パスワードでしかログインできず、未設定の人はマジックリンクのみで
// ログインできる、という使い分けを中心に確認する。

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const email = `magic-${Date.now()}@example.com`;
const companyName = `マジックリンク確認株式会社${Date.now()}`;

try {
  // --- 登録: 名前・メールのみ、パスワード欄が無い ---
  await page.goto("http://localhost:3000/register");
  await waitForPageReady(page);
  const hasPasswordField = await page.locator("#password").count();
  log("登録フォームにパスワード欄が無い", hasPasswordField === 0);

  await page.fill("#name", "マジックリンク太郎");
  await page.fill("#email", email);
  await page.click("button[type=submit]");
  await page.waitForTimeout(500);
  let body = await page.textContent("body");
  log("送信後「確認メールを送信しました」の案内が出る", body.includes("確認メールを送信しました") || body.includes("確認メールを"));

  const userRow = () => psql(`select "passwordHash" is null, "emailVerified" from "User" where email='${email}';`);
  log("この時点ではまだemailVerified=false", userRow() === "t|f");

  const magicLinkUrl = extractMagicLinkFromLog();
  await page.goto(magicLinkUrl);
  await waitForPageReady(page);
  await page.waitForURL("http://localhost:3000/register/company");
  await waitForPageReady(page);
  log("確認後、emailVerified=trueになる", userRow() === "t|t");

  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  await waitForPageReady(page);
  log("会社作成画面を経て/companyに入れる", page.url() === "http://localhost:3000/company");

  // --- 同じ確認リンクをもう一度踏んでも無効（ログアウトした状態で確認 —
  //     ログイン中だとプロキシが/loginから/homeへ戻してしまい判定できない） ---
  await page.click('button[aria-label="プロフィールメニュー"]');
  await page.waitForTimeout(200);
  await page.click("text=ログアウト");
  await page.waitForURL("http://localhost:3000/login");
  await waitForPageReady(page);
  await page.goto(magicLinkUrl);
  await waitForPageReady(page);
  await page.waitForTimeout(500);
  log("使用済みのマジックリンクは無効になる", page.url() === "http://localhost:3000/login?magicLink=error");

  // 再ログインして以降のテストを続ける
  await page.goto("http://localhost:3000/login");
  await waitForPageReady(page);
  await page.click("text=パスワードをお持ちでない方はこちら（メールでログイン）");
  await page.fill("#magicLinkEmail", email);
  await page.getByRole("button", { name: "ログイン用リンクを送信する" }).click();
  await page.waitForTimeout(600);
  await page.goto(extractMagicLinkFromLog());
  await waitForPageReady(page);
  await page.waitForURL("http://localhost:3000/company");
  await waitForPageReady(page);

  // --- アカウント設定: パスワード未設定の見た目 ---
  await page.goto("http://localhost:3000/company");
  await waitForPageReady(page);
  await page.click('button[aria-label="プロフィールメニュー"]');
  await page.click('a[aria-label="アカウント設定"]');
  await page.waitForURL("http://localhost:3000/account");
  await waitForPageReady(page);
  body = await page.textContent("body");
  log("パスワード未設定の間は「パスワードを設定する」セクションが出る", body.includes("パスワードを設定する"));
  log("パスワード未設定の間はメール変更フォームの代わりに案内文が出る", body.includes("メールアドレスを変更するには、先にパスワードを設定してください"));

  // --- パスワードを設定 ---
  await page.fill("#newPassword", "mypassword123");
  await page.getByRole("button", { name: "パスワードを設定する" }).click();
  await page.getByText("パスワードを設定しました。").waitFor({ timeout: 8000 });
  log("パスワードを設定すると「パスワードを変更する」セクションに変わる", (await page.textContent("body")).includes("パスワードを変更する"));
  log("DB上もpasswordHashが設定される", psql(`select "passwordHash" is not null from "User" where email='${email}';`) === "t");

  // --- パスワード設定済みなら、ログイン用マジックリンクの代わりに案内メールが届く ---
  await page.goto("http://localhost:3000/company");
  await waitForPageReady(page);
  await page.click('button[aria-label="プロフィールメニュー"]');
  await page.waitForTimeout(200);
  await page.click("text=ログアウト");
  await page.waitForURL("http://localhost:3000/login");
  await waitForPageReady(page);

  await page.click("text=パスワードをお持ちでない方はこちら（メールでログイン）");
  await page.fill("#magicLinkEmail", email);
  const logSizeBefore = execSync("stat -c%s /tmp/nextdev.log").toString().trim();
  await page.getByRole("button", { name: "ログイン用リンクを送信する" }).click();
  await page.waitForTimeout(600);
  const logAfter = execSync(`tail -c +${Number(logSizeBefore) + 1} /tmp/nextdev.log`).toString();
  log(
    "パスワード設定済みだとマジックリンクではなく「パスワードでログイン」案内メールが届く",
    logAfter.includes("ログインにはパスワードが必要です") && !logAfter.includes("/magic-link/"),
  );

  // --- パスワードでログインできる ---
  await page.goto("http://localhost:3000/login");
  await waitForPageReady(page);
  await page.fill("#email", email);
  await page.fill("#password", "mypassword123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  await waitForPageReady(page);
  log("設定したパスワードでログインできる", page.url() === "http://localhost:3000/company");

  // --- パスワードを削除してマジックリンクのみに戻す ---
  await page.goto("http://localhost:3000/account");
  await waitForPageReady(page);
  await page.click("text=パスワードを削除してマジックリンクのみに戻す");
  await page.fill("#currentPasswordForRemove", "mypassword123");
  await page.getByRole("button", { name: "パスワードを削除する" }).click();
  await page.getByText("パスワードを削除しました。").waitFor({ timeout: 8000 });
  log("削除後は「パスワードを設定する」セクションに戻る", (await page.textContent("body")).includes("パスワードを設定する"));
  log("DB上もpasswordHashがnullに戻る", psql(`select "passwordHash" is null from "User" where email='${email}';`) === "t");

  // --- パスワード削除後は、今度こそマジックリンクでログインできる ---
  await page.goto("http://localhost:3000/company");
  await waitForPageReady(page);
  await page.click('button[aria-label="プロフィールメニュー"]');
  await page.waitForTimeout(200);
  await page.click("text=ログアウト");
  await page.waitForURL("http://localhost:3000/login");
  await waitForPageReady(page);
  await page.click("text=パスワードをお持ちでない方はこちら（メールでログイン）");
  await page.fill("#magicLinkEmail", email);
  await page.getByRole("button", { name: "ログイン用リンクを送信する" }).click();
  await page.waitForTimeout(600);
  await page.goto(extractMagicLinkFromLog());
  await waitForPageReady(page);
  await page.waitForURL("http://localhost:3000/company");
  await waitForPageReady(page);
  log("パスワード削除後はマジックリンクでログインできる", page.url() === "http://localhost:3000/company");

  // --- 連投防止のクールダウン: 直後にもう一度申請しても新しいメールは送られない ---
  await page.goto("http://localhost:3000/company");
  await waitForPageReady(page);
  await page.click('button[aria-label="プロフィールメニュー"]');
  await page.waitForTimeout(200);
  await page.click("text=ログアウト");
  await page.waitForURL("http://localhost:3000/login");
  await waitForPageReady(page);
  await page.click("text=パスワードをお持ちでない方はこちら（メールでログイン）");
  await page.fill("#magicLinkEmail", email);
  await page.getByRole("button", { name: "ログイン用リンクを送信する" }).click();
  await page.waitForTimeout(600);
  const tokenCountAfterFirst = psql(
    `select count(*) from "AccountActionToken" t join "User" u on u.id=t."userId" where t.kind='MAGIC_LINK' and u.email='${email}' and t."usedAt" is null;`,
  );
  await page.goto("http://localhost:3000/login");
  await waitForPageReady(page);
  await page.click("text=パスワードをお持ちでない方はこちら（メールでログイン）");
  await page.fill("#magicLinkEmail", email);
  await page.getByRole("button", { name: "ログイン用リンクを送信する" }).click();
  await page.waitForTimeout(600);
  const tokenCountAfterSecond = psql(
    `select count(*) from "AccountActionToken" t join "User" u on u.id=t."userId" where t.kind='MAGIC_LINK' and u.email='${email}' and t."usedAt" is null;`,
  );
  log("短時間に連続申請しても新しいトークンは作られない（迷惑メール連投防止）", tokenCountAfterFirst === tokenCountAfterSecond);

  // --- 存在しないメールアドレスでも同じ案内文（列挙対策） ---
  await page.goto("http://localhost:3000/login");
  await waitForPageReady(page);
  await page.click("text=パスワードをお持ちでない方はこちら（メールでログイン）");
  await page.fill("#magicLinkEmail", `nonexistent-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "ログイン用リンクを送信する" }).click();
  await page.waitForTimeout(400);
  body = await page.textContent("body");
  log("存在しないメールアドレスでも同じ案内文が表示される（列挙対策）", body.includes("送信しました"));

  console.log(process.exitCode ? "MAGIC LINK AUTH SMOKE TEST HAD FAILURES" : "MAGIC LINK AUTH SMOKE TEST PASSED");
} catch (err) {
  console.error("MAGIC LINK AUTH SMOKE TEST FAILED", err);
  await page.screenshot({ path: "/tmp/smoke-magic-link-auth-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
