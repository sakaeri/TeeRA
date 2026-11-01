import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";
import { requestLoginLink } from "./_lib/login.mjs";

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
  await page.waitForURL("http://localhost:3000/register/company");
  log("確認後、emailVerified=trueになる", userRow() === "t|t");

  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  log("会社作成画面を経て/companyに入れる", page.url() === "http://localhost:3000/company");

  // --- 同じ確認リンクをもう一度踏んでも無効（ログアウトした状態で確認 —
  //     ログイン中だとプロキシが/loginから/homeへ戻してしまい判定できない） ---
  await page.click('button[aria-label="プロフィールメニュー"]');
  await page.waitForTimeout(200);
  await page.click("text=ログアウト");
  await page.waitForURL("http://localhost:3000/login");
  await page.goto(magicLinkUrl);
  await page.waitForTimeout(500);
  log("使用済みのマジックリンクは無効になる", page.url() === "http://localhost:3000/login?magicLink=error");

  // 再ログインして以降のテストを続ける
  await page.goto(await requestLoginLink(page, email));
  await page.waitForURL("http://localhost:3000/company");

  // --- アカウント設定: パスワード未設定の見た目 ---
  await page.goto("http://localhost:3000/company");
  await page.click('button[aria-label="プロフィールメニュー"]');
  await page.click('a[aria-label="アカウント設定"]');
  await page.waitForURL("http://localhost:3000/account");
  body = await page.textContent("body");
  log("パスワード未設定の間は「パスワードを設定する」セクションが出る", body.includes("パスワードを設定する"));
  log("パスワード未設定の間はメール変更フォームの代わりに案内文が出る", body.includes("メールアドレスを変更するには、先にパスワードを設定してください"));

  // --- パスワードを設定 ---
  await page.fill("#newPassword", "mypassword123");
  await page.getByRole("button", { name: "パスワードを設定する" }).click();
  await page.getByText("パスワードを設定しました。").waitFor({ timeout: 8000 });
  log("パスワードを設定すると「パスワードを変更する」セクションに変わる", (await page.textContent("body")).includes("パスワードを変更する"));
  log("DB上もpasswordHashが設定される", psql(`select "passwordHash" is not null from "User" where email='${email}';`) === "t");

  async function logout() {
    await page.goto("http://localhost:3000/company");
    await page.click('button[aria-label="プロフィールメニュー"]');
    await page.waitForTimeout(200);
    await page.click("text=ログアウト");
    await page.waitForURL("http://localhost:3000/login");
  }

  // --- ログイン画面はメールアドレスだけ（メールアドレス＋パスワードの入口は無い） ---
  await logout();
  log("ログイン画面にパスワード欄が無い", (await page.locator("#password").count()) === 0);

  // --- パスワード設定済みでも、まずメールのリンクが届き、開くとパスワード入力（2段階目）になる ---
  const link = await requestLoginLink(page, email);
  const loginToken = psql(
    `select extract(epoch from (t."expiresAt" - t."createdAt"))::int from "AccountActionToken" t join "User" u on u.id=t."userId" where t.kind='MAGIC_LINK' and u.email='${email}' order by t."createdAt" desc limit 1;`,
  );
  log("ログイン用リンクの有効期限は15分", loginToken === "900");
  // リンクのトークンだけで、パスワード入力を飛ばして直接ログインしようとしても通らない
  const csrf = (await (await page.request.get("http://localhost:3000/api/auth/csrf")).json()).csrfToken;
  await page.request.post("http://localhost:3000/api/auth/callback/magic-link", {
    form: { token: link.split("/magic-link/")[1], csrfToken: csrf },
    maxRedirects: 0,
  });
  log(
    "リンクのトークンだけで直接ログインしようとしても、パスワードを飛ばせない",
    (await (await page.request.get("http://localhost:3000/company", { maxRedirects: 0 })).status()) === 307,
  );
  await page.goto(link);
  await page.waitForURL(/\/login\/password\//);
  log("パスワード設定済みだと、リンクの後にパスワード入力画面になる", (await page.locator("#password").count()) === 1);
  log("この時点ではまだログインしていない", (await (await page.request.get("http://localhost:3000/company", { maxRedirects: 0 })).status()) === 307);
  await page.fill("#password", "mypassword123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  log("パスワードを入れるとログインできる", page.url() === "http://localhost:3000/company");

  // --- パスワードを削除してマジックリンクのみに戻す ---
  await page.goto("http://localhost:3000/account");
  await page.click("text=パスワードを削除してマジックリンクのみに戻す");
  await page.fill("#currentPasswordForRemove", "mypassword123");
  await page.getByRole("button", { name: "パスワードを削除する" }).click();
  await page.getByText("パスワードを削除しました。").waitFor({ timeout: 8000 });
  log("削除後は「パスワードを設定する」セクションに戻る", (await page.textContent("body")).includes("パスワードを設定する"));
  log("DB上もpasswordHashがnullに戻る", psql(`select "passwordHash" is null from "User" where email='${email}';`) === "t");

  // --- パスワード削除後は、リンクだけでログインできる ---
  await logout();
  await page.goto(await requestLoginLink(page, email));
  await page.waitForURL("http://localhost:3000/company");
  log("パスワード削除後はリンクだけでログインできる", page.url() === "http://localhost:3000/company");

  // --- 連投防止のクールダウン: 直後にもう一度申請しても新しいメールは送られない ---
  await logout();
  await page.fill("#email", email);
  await page.click("button[type=submit]");
  await page.waitForTimeout(600);
  const tokenCountAfterFirst = psql(
    `select count(*) from "AccountActionToken" t join "User" u on u.id=t."userId" where t.kind='MAGIC_LINK' and u.email='${email}' and t."usedAt" is null;`,
  );
  await page.goto("http://localhost:3000/login");
  await page.fill("#email", email);
  await page.click("button[type=submit]");
  await page.waitForTimeout(600);
  const tokenCountAfterSecond = psql(
    `select count(*) from "AccountActionToken" t join "User" u on u.id=t."userId" where t.kind='MAGIC_LINK' and u.email='${email}' and t."usedAt" is null;`,
  );
  log("短時間に連続申請しても新しいトークンは作られない（迷惑メール連投防止）", tokenCountAfterFirst === tokenCountAfterSecond);

  // --- 存在しないメールアドレスでも同じ案内文（列挙対策） ---
  await page.goto("http://localhost:3000/login");
  await page.fill("#email", `nonexistent-${Date.now()}@example.com`);
  await page.click("button[type=submit]");
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
