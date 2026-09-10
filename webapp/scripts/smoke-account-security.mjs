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

// パスワード忘れ時のリセット、ログイン中のパスワード変更、メールアドレス
// 変更（確認メール必須）の検証。RESEND_API_KEY未設定のこの環境では実際の
// メール送信は行われず、コンソールにログされるだけなので、トークンは
// DBから直接（AccountActionToken.tokenHashを検証できないので、代わりに
// 生トークンをコンソール出力から拾う）取得する。

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext();
const page = await ctx.newPage();

function extractTokenFromLog(logText, pathPrefix) {
  const re = new RegExp(`${pathPrefix}([A-Za-z0-9_-]+)`, "g");
  const matches = [...logText.matchAll(re)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

const email = `account-sec-${Date.now()}@example.com`;
const companyName = `アカウント確認株式会社${Date.now()}`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "アカウント確認管理者");
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");

  // --- ログイン画面に「パスワードをお忘れですか？」リンクがある ---
  await page.click('button[aria-label="プロフィールメニュー"]');
  await page.waitForTimeout(200);
  await page.click("text=ログアウト");
  await page.waitForURL("http://localhost:3000/login");
  let body = await page.textContent("body");
  log("ログイン画面に「パスワードをお忘れですか？」リンクがある", body.includes("パスワードをお忘れですか？"));

  // --- パスワードリセット: 存在するメールアドレス ---
  await page.click("text=パスワードをお忘れですか？");
  await page.waitForURL("http://localhost:3000/forgot-password");
  await page.fill("#email", email);
  await page.getByRole("button", { name: "再設定メールを送信する" }).click();
  await page.waitForTimeout(600);
  body = await page.textContent("body");
  log("送信後に案内メッセージが表示される", body.includes("送信しました"));

  const logAfterRequest = execSync("tail -c 200000 /tmp/nextdev.log").toString();
  const resetToken = extractTokenFromLog(logAfterRequest, "/reset-password/");
  log("パスワードリセットのトークンがログに出力される（メール送信の代替確認）", Boolean(resetToken));

  const tokenCount = psql(
    `select count(*) from "AccountActionToken" t join "User" u on u.id = t."userId" where t.kind='PASSWORD_RESET' and u.email='${email}';`,
  );
  log("AccountActionTokenがPASSWORD_RESETで1件作成される", tokenCount === "1");

  // --- 存在しないメールアドレスでも同じ案内文（列挙対策） ---
  const nonexistentEmail = `nonexistent-${Date.now()}@example.com`;
  await page.goto("http://localhost:3000/forgot-password");
  await page.fill("#email", nonexistentEmail);
  await page.getByRole("button", { name: "再設定メールを送信する" }).click();
  await page.waitForTimeout(600);
  body = await page.textContent("body");
  log("存在しないメールアドレスでも同じ案内文が表示される（列挙対策）", body.includes("送信しました"));
  const tokenCountForOriginalUser = psql(
    `select count(*) from "AccountActionToken" t join "User" u on u.id = t."userId" where t.kind='PASSWORD_RESET' and u.email='${email}';`,
  );
  log("存在しないメールアドレスではトークンが作られない", tokenCountForOriginalUser === "1");

  // --- 無効なトークンでリセット画面を開くとエラーになる ---
  await page.goto("http://localhost:3000/reset-password/invalid-token-xyz");
  await page.fill("#password", "newpassword123");
  await page.getByRole("button", { name: "パスワードを変更する" }).click();
  await page.waitForTimeout(800);
  body = await page.textContent("body");
  log("無効なトークンではエラーメッセージが表示される", body.includes("無効か"));

  // --- 有効なトークンでパスワードをリセット ---
  await page.goto(`http://localhost:3000/reset-password/${resetToken}`);
  await page.fill("#password", "newpassword123");
  await page.getByRole("button", { name: "パスワードを変更する" }).click();
  await page.waitForURL(/\/login\?reset=1/);
  body = await page.textContent("body");
  log("リセット後にログイン画面へ遷移し成功メッセージが出る", body.includes("パスワードを変更しました"));

  // 旧パスワードではログインできない
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForTimeout(500);
  body = await page.textContent("body");
  log("旧パスワードではログインできない", body.includes("正しくありません"));

  // 新パスワードでログインできる
  await page.fill("#email", email);
  await page.fill("#password", "newpassword123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  log("新パスワードでログインできる", page.url() === "http://localhost:3000/company");

  // 使用済みトークンは再利用できない
  await page.goto(`http://localhost:3000/reset-password/${resetToken}`);
  await page.fill("#password", "anotherpassword123");
  await page.getByRole("button", { name: "パスワードを変更する" }).click();
  await page.waitForTimeout(600);
  body = await page.textContent("body");
  log("使用済みトークンは再利用できない", body.includes("無効か"));

  // --- アカウント設定画面: ドロップダウンから到達できる ---
  await page.goto("http://localhost:3000/company");
  await page.click('button[aria-label="プロフィールメニュー"]');
  await page.waitForTimeout(200);
  await page.click("text=アカウント設定");
  await page.waitForURL("http://localhost:3000/account");
  body = await page.textContent("body");
  log("アカウント設定画面に「パスワードを変更する」セクションがある", body.includes("パスワードを変更する"));
  log("アカウント設定画面に「メールアドレスを変更する」セクションがある", body.includes("メールアドレスを変更する"));
  log("現在のメールアドレスが表示される", body.includes(email));

  // --- ログイン中のパスワード変更: 現パスワード誤り ---
  await page.fill("#currentPassword", "wrongpassword123");
  await page.fill("#newPassword", "yetanotherpassword123");
  await page.getByRole("button", { name: "パスワードを変更する" }).click();
  await page.waitForTimeout(800);
  body = await page.textContent("body");
  log("現在のパスワードが誤っていればエラーになる", body.includes("正しくありません"));

  // --- ログイン中のパスワード変更: 成功 ---
  // bcrypt(cost 12)を2回(compare+hash)行うため、固定waitだと環境負荷次第で
  // 間に合わないことがある — 固定時間ではなくメッセージの出現自体を待つ。
  await page.fill("#currentPassword", "newpassword123");
  await page.fill("#newPassword", "yetanotherpassword123");
  await page.getByRole("button", { name: "パスワードを変更する" }).click();
  await page.getByText("パスワードを変更しました。").waitFor({ timeout: 5000 }).catch(() => {});
  body = await page.textContent("body");
  log("正しい現パスワードで変更に成功する", body.includes("パスワードを変更しました。"));

  // ログアウトして新パスワードでログインできることを確認
  await page.goto("http://localhost:3000/company");
  await page.click('button[aria-label="プロフィールメニュー"]');
  await page.waitForTimeout(200);
  await page.click("text=ログアウト");
  await page.waitForURL("http://localhost:3000/login");
  await page.fill("#email", email);
  await page.fill("#password", "yetanotherpassword123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  log("ログイン中のパスワード変更後、新パスワードでログインできる", page.url() === "http://localhost:3000/company");

  // --- メールアドレス変更: 現パスワード誤り ---
  await page.goto("http://localhost:3000/account");
  const newEmail = `account-sec-new-${Date.now()}@example.com`;
  await page.fill("#newEmail", newEmail);
  await page.fill("#currentPasswordForEmail", "wrongpassword");
  await page.getByRole("button", { name: "確認メールを送信する" }).click();
  await page.waitForTimeout(800);
  body = await page.textContent("body");
  log("メール変更: 現在のパスワードが誤っていればエラーになる", body.includes("正しくありません"));

  // --- メールアドレス変更: 成功（確認メール送信、まだ変更されない） ---
  await page.fill("#newEmail", newEmail);
  await page.fill("#currentPasswordForEmail", "yetanotherpassword123");
  await page.getByRole("button", { name: "確認メールを送信する" }).click();
  await page.waitForTimeout(800);
  body = await page.textContent("body");
  log("確認メール送信の案内が表示される", body.includes("確認メールを送信しました"));

  const stillOldEmail = psql(`select email from "User" where email='${email}';`);
  log("確認前はまだメールアドレスが変更されていない", stillOldEmail === email);

  const logAfterEmailChange = execSync("tail -c 200000 /tmp/nextdev.log").toString();
  const confirmToken = extractTokenFromLog(logAfterEmailChange, "/confirm-email-change/");
  log("メール変更確認トークンがログに出力される", Boolean(confirmToken));

  // --- 確認リンクをクリックして変更を確定 ---
  await page.goto(`http://localhost:3000/confirm-email-change/${confirmToken}`);
  await page.waitForURL(/\/account\?emailChange=success/);
  body = await page.textContent("body");
  log("確認後に成功メッセージが表示される", body.includes("メールアドレスの変更が完了しました"));

  const updatedEmail = psql(`select email from "User" where email='${newEmail}';`);
  log("DB上でもメールアドレスが変更されている", updatedEmail === newEmail);

  // 新メールアドレスでログインできる
  await page.goto("http://localhost:3000/company");
  await page.click('button[aria-label="プロフィールメニュー"]');
  await page.waitForTimeout(200);
  await page.click("text=ログアウト");
  await page.waitForURL("http://localhost:3000/login");
  await page.fill("#email", newEmail);
  await page.fill("#password", "yetanotherpassword123");
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  log("変更後の新しいメールアドレスでログインできる", page.url() === "http://localhost:3000/company");

  // 無効な確認トークンではエラー画面に遷移する
  await page.goto("http://localhost:3000/confirm-email-change/invalid-token-xyz");
  await page.waitForURL(/\/account\?emailChange=error/);
  body = await page.textContent("body");
  log("無効な確認トークンではエラーメッセージが表示される", body.includes("確認リンクが無効か"));

  console.log(process.exitCode ? "ACCOUNT SECURITY SMOKE TEST HAD FAILURES" : "ACCOUNT SECURITY SMOKE TEST PASSED");
} catch (err) {
  console.error("ACCOUNT SECURITY SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
