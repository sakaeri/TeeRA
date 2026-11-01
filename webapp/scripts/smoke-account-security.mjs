import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";
import { requestLoginLink, loginViaEmail } from "./_lib/login.mjs";

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

// ログインの守り（メールのリンク＋パスワードの2段階・続けて間違えたらロック・
// ログインのお知らせ・パスワード再設定は24時間後に有効・すべての端末からログアウト）、
// ログイン中のパスワード変更、メールアドレス変更（確認メール必須）の検証。RESEND_API_KEY未設定のこの環境では実際の
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
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");

  const DEV_LOG = "/tmp/nextdev.log";
  const logSize = () => readFileSync(DEV_LOG, "utf8").length;
  const logSince = (start) => readFileSync(DEV_LOG, "utf8").slice(start);
  async function logout(p = page) {
    await p.goto("http://localhost:3000/company");
    await p.click('button[aria-label="プロフィールメニュー"]');
    await p.waitForTimeout(200);
    await p.click("text=ログアウト");
    await p.waitForURL("http://localhost:3000/login");
  }
  async function openPasswordStep() {
    await page.goto(await requestLoginLink(page, email));
    await page.waitForURL(/\/login\/password\//);
  }
  async function submitPassword(password) {
    await page.fill("#password", password);
    await page.click("button[type=submit]");
  }
  let body;

  // --- パスワードを設定する（以後はリンク＋パスワードの2段階） ---
  await page.goto("http://localhost:3000/account");
  await page.fill("#newPassword", "password123");
  await page.getByRole("button", { name: "パスワードを設定する" }).click();
  await page.getByText("パスワードを設定しました。").waitFor({ timeout: 8000 });

  // --- 2段階目：間違えると残り回数が出る。正しければログインでき、お知らせメールが届く ---
  await logout();
  await openPasswordStep();
  await submitPassword("wrongpassword1");
  await page.getByText("パスワードが正しくありません").waitFor({ timeout: 8000 });
  body = await page.textContent("body");
  log("パスワードを間違えると残り回数が出る", body.includes("あと4回"));
  let start = logSize();
  await submitPassword("password123");
  await page.waitForURL("http://localhost:3000/company");
  log("正しいパスワードでログインできる", page.url() === "http://localhost:3000/company");
  await page.waitForTimeout(500);
  const notice = logSince(start);
  log("ログインのお知らせメールが届く（日時・端末つき）", notice.includes("ログインがありました") && notice.includes("端末："));
  log("成功したら間違えた回数は0に戻る", psql(`select "failedPasswordAttempts" from "User" where email='${email}';`) === "0");

  // --- 続けて5回間違えるとロックされ、正しいパスワードでも入れない ---
  await logout();
  await openPasswordStep();
  for (let i = 0; i < 5; i++) {
    await submitPassword(`wrongpassword${i}`);
    await page.waitForTimeout(1500);
  }
  await page.getByText("ロックしています").waitFor({ timeout: 8000 });
  log("5回続けて間違えるとロックされる", (await page.textContent("body")).includes("ロックしています"));
  await submitPassword("password123");
  await page.waitForTimeout(1500);
  log("ロック中は正しいパスワードでも入れない", page.url().includes("/login/password/"));
  psql(`update "User" set "passwordLockedUntil"=null where email='${email}';`);

  // --- 使い切ったパスワード入力画面は使えない ---
  const stepUrl = page.url();
  await submitPassword("password123");
  await page.waitForURL("http://localhost:3000/company");
  await logout();
  await page.goto(stepUrl);
  body = await page.textContent("body");
  log("使い終わったパスワード入力画面は使えない", body.includes("有効期限") && (await page.locator("#password").count()) === 0);

  // --- パスワードを忘れた：再設定は24時間後に有効。それまでは元のパスワード ---
  await openPasswordStep();
  await page.click("text=パスワードをお忘れですか？");
  await page.waitForURL("http://localhost:3000/forgot-password");
  start = logSize();
  await page.fill("#email", email);
  await page.getByRole("button", { name: "再設定メールを送信する" }).click();
  await page.getByText("送信しました").first().waitFor();
  const resetToken = extractTokenFromLog(logSince(start), "/reset-password/");
  log("再設定メールのリンクが届く", Boolean(resetToken));

  // 存在しないメールアドレスでも同じ案内文（列挙対策）
  await page.goto("http://localhost:3000/forgot-password");
  await page.fill("#email", `nonexistent-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "再設定メールを送信する" }).click();
  await page.getByText("送信しました").first().waitFor();
  log("存在しないメールアドレスでも同じ案内文が表示される（列挙対策）", true);

  await page.goto("http://localhost:3000/reset-password/invalid-token-xyz");
  await page.fill("#password", "newpassword123");
  await page.getByRole("button", { name: "パスワードを変更する" }).click();
  await page.getByText("無効か").waitFor({ timeout: 8000 });
  log("無効なトークンではエラーメッセージが表示される", true);

  start = logSize();
  await page.goto(`http://localhost:3000/reset-password/${resetToken}`);
  await page.fill("#password", "newpassword123");
  await page.getByRole("button", { name: "パスワードを変更する" }).click();
  await page.getByText("再設定を受け付けました").waitFor({ timeout: 8000 });
  log("再設定すると「24時間後から使える」と出る", (await page.textContent("body")).includes("24時間後"));
  await page.waitForTimeout(500);
  const scheduledMail = logSince(start);
  const cancelToken = extractTokenFromLog(scheduledMail, "/cancel-password-reset/");
  log("受け付けと取り消しリンクのメールが届く", scheduledMail.includes("パスワードの再設定を受け付けました") && Boolean(cancelToken));
  log("まだ元のパスワードのまま（新しいパスワードは保留）", psql(`select "pendingPasswordHash" is not null and "pendingPasswordEffectiveAt" > now() + interval '23 hours' from "User" where email='${email}';`) === "t");

  // 24時間たつまでは新しいパスワードでは入れず、元のパスワードで入れる
  await openPasswordStep();
  await submitPassword("newpassword123");
  await page.getByText("パスワードが正しくありません").waitFor({ timeout: 8000 });
  log("24時間たつまでは新しいパスワードでは入れない", true);
  await submitPassword("password123");
  await page.waitForURL("http://localhost:3000/company");
  log("24時間たつまでは元のパスワードで入れる", page.url() === "http://localhost:3000/company");

  // アカウント設定に「受け付け中」と取り消しボタンが出る。メールのリンクからも取り消せる
  await page.goto("http://localhost:3000/account");
  log("アカウント設定に再設定の受け付け中が出る", (await page.textContent("body")).includes("パスワードの再設定を受け付けています"));
  await page.goto(`http://localhost:3000/cancel-password-reset/${cancelToken}`);
  log("取り消しページを開いただけでは取り消されない", psql(`select "pendingPasswordHash" is not null from "User" where email='${email}';`) === "t");
  await page.getByRole("button", { name: "再設定を取り消す" }).click();
  await page.getByText("取り消しました").waitFor({ timeout: 8000 });
  log("メールのリンクから再設定を取り消せる", psql(`select "pendingPasswordHash" is null from "User" where email='${email}';`) === "t");

  // もう一度再設定し、24時間たった（ことにする）と新しいパスワードに切り替わり、ほかの端末はログアウトされる
  await page.goto("http://localhost:3000/forgot-password");
  start = logSize();
  await page.fill("#email", email);
  await page.getByRole("button", { name: "再設定メールを送信する" }).click();
  await page.getByText("送信しました").first().waitFor();
  const resetToken2 = extractTokenFromLog(logSince(start), "/reset-password/");
  await page.goto(`http://localhost:3000/reset-password/${resetToken2}`);
  await page.fill("#password", "newpassword123");
  await page.getByRole("button", { name: "パスワードを変更する" }).click();
  await page.getByText("再設定を受け付けました").waitFor({ timeout: 8000 });
  psql(`update "User" set "pendingPasswordEffectiveAt"=now() - interval '1 minute' where email='${email}';`);
  await page.goto("http://localhost:3000/company");
  log("（ここまでの端末はまだログイン中）", page.url() === "http://localhost:3000/company");
  await logout();
  await openPasswordStep();
  await submitPassword("password123");
  await page.getByText("パスワードが正しくありません").waitFor({ timeout: 8000 });
  log("24時間たつと元のパスワードでは入れない", true);
  await submitPassword("newpassword123");
  await page.waitForURL("http://localhost:3000/company");
  log("24時間たつと新しいパスワードで入れる", page.url() === "http://localhost:3000/company");

  // --- アカウント設定画面: プロフィールメニュー内の鉛筆アイコンから到達できる ---
  await page.click('button[aria-label="プロフィールメニュー"]');
  await page.click('a[aria-label="アカウント設定"]');
  await page.waitForURL("http://localhost:3000/account");
  body = await page.textContent("body");
  log("アカウント設定画面に「パスワードを変更する」セクションがある", body.includes("パスワードを変更する"));
  log("アカウント設定画面に「メールアドレスを変更する」セクションがある", body.includes("メールアドレスを変更する"));
  log("アカウント設定画面に「すべての端末からログアウト」がある", body.includes("すべての端末からログアウト"));
  log("現在のメールアドレスが表示される", body.includes(email));

  // --- ログイン中のパスワード変更: 現パスワード誤り ---
  await page.fill("#currentPassword", "wrongpassword123");
  await page.fill("#newPassword", "yetanotherpassword123");
  await page.getByRole("button", { name: "パスワードを変更する" }).click();
  await page.getByText("正しくありません").waitFor({ timeout: 8000 });
  log("現在のパスワードが誤っていればエラーになる", true);

  // --- ログイン中のパスワード変更: 成功すると、この端末もほかの端末もログアウトされる ---
  const other = await (await browser.newContext()).newPage();
  await loginViaEmail(other, email, "newpassword123");
  log("（別の端末でもログイン）", other.url() === "http://localhost:3000/company");
  await page.fill("#currentPassword", "newpassword123");
  await page.fill("#newPassword", "yetanotherpassword123");
  await page.getByRole("button", { name: "パスワードを変更する" }).click();
  await page.waitForURL(/\/login\?passwordChanged=1/, { timeout: 15000 });
  log("パスワードを変えると、この端末はログアウトしてログイン画面へ", (await page.textContent("body")).includes("パスワードを変更しました"));
  await other.goto("http://localhost:3000/company");
  log("パスワードを変えると、ほかの端末もログアウトされる", other.url().startsWith("http://localhost:3000/login"));
  await loginViaEmail(page, email, "yetanotherpassword123");
  log("新しいパスワードでログインできる", page.url() === "http://localhost:3000/company");

  // --- すべての端末からログアウト ---
  await loginViaEmail(other, email, "yetanotherpassword123");
  await page.goto("http://localhost:3000/account");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "すべての端末からログアウトする" }).click();
  await page.waitForURL(/\/login\?loggedOutAll=1/, { timeout: 15000 });
  log("「すべての端末からログアウト」でこの端末がログアウトされる", (await page.textContent("body")).includes("すべての端末からログアウトしました"));
  await other.goto("http://localhost:3000/company");
  log("「すべての端末からログアウト」でほかの端末もログアウトされる", other.url().startsWith("http://localhost:3000/login"));
  await loginViaEmail(page, email, "yetanotherpassword123");

  // --- メールアドレス変更: 現パスワード誤り ---
  await page.goto("http://localhost:3000/account");
  const newEmail = `account-sec-new-${Date.now()}@example.com`;
  await page.fill("#newEmail", newEmail);
  await page.fill("#currentPasswordForEmail", "wrongpassword");
  await page.getByRole("button", { name: "確認メールを送信する" }).click();
  await page.getByText("正しくありません").waitFor({ timeout: 8000 }).catch(() => {});
  body = await page.textContent("body");
  log("メール変更: 現在のパスワードが誤っていればエラーになる", body.includes("正しくありません"));

  // --- メールアドレス変更: 成功（確認メール送信、まだ変更されない） ---
  await page.fill("#newEmail", newEmail);
  await page.fill("#currentPasswordForEmail", "yetanotherpassword123");
  await page.getByRole("button", { name: "確認メールを送信する" }).click();
  await page.getByText("確認メールを送信しました").waitFor({ timeout: 8000 }).catch(() => {});
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
  await loginViaEmail(page, newEmail, "yetanotherpassword123");
  log("変更後の新しいメールアドレスでログインできる", page.url() === "http://localhost:3000/company");

  // 無効な確認トークンではエラー画面に遷移する
  await page.goto("http://localhost:3000/confirm-email-change/invalid-token-xyz");
  await page.waitForURL(/\/account\?emailChange=error/);
  body = await page.textContent("body");
  log("無効な確認トークンではエラーメッセージが表示される", body.includes("確認リンクが無効か"));

  console.log(process.exitCode ? "ACCOUNT SECURITY SMOKE TEST HAD FAILURES" : "ACCOUNT SECURITY SMOKE TEST PASSED");
} catch (err) {
  console.error("ACCOUNT SECURITY SMOKE TEST FAILED", err);
  console.error("URL:", page.url(), "BODY:", (await page.textContent("body").catch(() => "")).slice(0, 400));
  process.exitCode = 1;
} finally {
  await browser.close();
}
