import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const DEV_LOG_PATH = "/tmp/nextdev.log";

// ログイン画面から、メールに届くリンク（devログに出る）でログインする。
// パスワードを設定している人は、リンクの後にパスワードを入れる（2段階目）。
// passwordを渡さなければ、パスワード入力画面で止めずにそのまま返す（呼び出し側で確かめる用）。
export async function requestLoginLink(page, email) {
  const logStart = readFileSync(DEV_LOG_PATH, "utf8").length;
  await page.goto("http://localhost:3000/login");
  await page.fill("#email", email);
  await page.click("button[type=submit]");
  await page.getByText("ログイン用のリンクを送信しました").waitFor();
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const matches = [...readFileSync(DEV_LOG_PATH, "utf8").slice(logStart).matchAll(/\/magic-link\/([A-Za-z0-9_-]+)/g)];
    if (matches.length) return `http://localhost:3000/magic-link/${matches[matches.length - 1][1]}`;
    execSync("sleep 0.2");
  }
  throw new Error("devログにログイン用リンクが見つかりません");
}

export async function loginViaEmail(page, email, password) {
  const link = await requestLoginLink(page, email);
  await page.goto(link);
  if (password) {
    await page.waitForURL(/\/login\/password\//);
    await page.fill("#password", password);
    await page.click("button[type=submit]");
  }
  // ログイン後は /home を経由して各画面へ移るので、/home でもない画面に着くまで待つ
  await page.waitForURL((url) => !url.pathname.startsWith("/login") && url.pathname !== "/home", { timeout: 15000 });
}
