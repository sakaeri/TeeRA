import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// ログイン用メールの6桁コードでログインする（ホーム画面に追加したアプリ用。
// リンクだとブラウザで開いてしまうため）：
// ・メールを送るとコード入力欄が出て、コードを入れるとログインできる
// ・間違えると残り回数が出て、5回間違えるとそのコードは使えない（すぐ送り直せる）
// ・コードは1回だけ使える
// ・パスワードを設定している人は、コードの後にパスワード入力へ進む
// ・ログイン前に開こうとした画面（from）へ戻る

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`)
    .toString()
    .trim();
}
const DEV_LOG = "/tmp/nextdev.log";
const logSize = () => readFileSync(DEV_LOG, "utf8").length;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const email = `login-code-${Date.now()}@example.com`;

// ログイン画面でメールを送り、届いたコードを返す
async function requestCode(path = "/login") {
  const start = logSize();
  await page.goto(`http://localhost:3000${path}`);
  if (!page.url().includes("/login")) throw new Error("ログイン画面ではありません");
  await page.fill("#email", email);
  await page.getByRole("button", { name: "ログイン用のメールを送信する" }).click();
  await page.locator("#code").waitFor();
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const m = [...readFileSync(DEV_LOG, "utf8").slice(start).matchAll(/件名=【TeeRA】ログインコード (\d{6})/g)];
    if (m.length) return m[m.length - 1][1];
    execSync("sleep 0.2");
  }
  throw new Error("コードがログに見つかりません");
}
async function enterCode(code) {
  await page.fill("#code", code);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
}
const wrong = (code) => String((Number(code) + 1) % 1000000).padStart(6, "0");

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "コード確認");
  await page.fill("#email", email);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", `コード確認株式会社${Date.now()}`);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  await context.clearCookies();

  // --- コードでログイン（間違えると残り回数） ---
  const code1 = await requestCode();
  log("メールを送るとコード入力欄が出る", await page.locator("#code").isVisible());
  log("メールの件名にコードが入る", /^\d{6}$/.test(code1));
  await enterCode(wrong(code1));
  await page.getByText("コードが正しくありません").waitFor({ timeout: 8000 });
  log("間違えると残り回数が出る", (await page.textContent("body")).includes("あと4回"));
  await enterCode(code1);
  await page.waitForURL((u) => !u.pathname.startsWith("/login") && u.pathname !== "/home", { timeout: 15000 });
  log("正しいコードでログインできる", page.url() === "http://localhost:3000/company");
  await context.clearCookies();

  // --- 同じコードはもう使えない ---
  await page.goto("http://localhost:3000/login");
  await page.fill("#email", email);
  await page.getByRole("button", { name: "ログイン用のメールを送信する" }).click();
  await page.locator("#code").waitFor();
  // 新しいメールのコードではなく、使い終わったコードを入れる
  psql(`update "AccountActionToken" set "usedAt"=now() where kind='MAGIC_LINK' and "userId"=(select id from "User" where email='${email}') and "usedAt" is null;`);
  await enterCode(code1);
  await page.getByText("コードが無効か").waitFor({ timeout: 8000 });
  log("使い終わったコードはもう使えない", true);

  // --- 5回間違えるとそのコードは使えない。すぐ送り直せる ---
  const code2 = await requestCode();
  for (let i = 0; i < 5; i++) {
    await enterCode(wrong(code2));
    await page.waitForTimeout(800);
  }
  await enterCode(code2);
  await page.getByText("コードが無効か").waitFor({ timeout: 8000 });
  log("5回間違えると、正しいコードでも使えない", page.url().includes("/login"));
  const code3 = await requestCode();
  log("使えなくなった直後でも、新しいコードをすぐ受け取れる", code3 !== code2);
  await enterCode(code3);
  await page.waitForURL((u) => !u.pathname.startsWith("/login") && u.pathname !== "/home", { timeout: 15000 });
  log("新しいコードでログインできる", page.url() === "http://localhost:3000/company");

  // --- パスワードを設定している人は、コードの後にパスワード ---
  await page.goto("http://localhost:3000/account");
  await page.fill("#newPassword", "password123");
  await page.getByRole("button", { name: "パスワードを設定する" }).click();
  await page.getByText("パスワードを設定しました。").waitFor({ timeout: 8000 });
  await context.clearCookies();
  const code4 = await requestCode("/company/roster");
  await enterCode(code4);
  await page.waitForURL(/\/login\/password\//, { timeout: 15000 });
  log("パスワード設定済みだと、コードの後にパスワード入力になる", true);
  log("この時点ではまだログインしていない", (await (await page.request.get("http://localhost:3000/company", { maxRedirects: 0 })).status()) === 307);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login") && u.pathname !== "/home", { timeout: 15000 });
  log("パスワードを入れるとログインでき、開こうとした画面（名簿）に戻る", page.url().startsWith("http://localhost:3000/company/roster"));

  // --- 登録されていないメールアドレスでも同じ画面（列挙対策） ---
  await context.clearCookies();
  await page.goto("http://localhost:3000/login");
  await page.fill("#email", `nobody-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "ログイン用のメールを送信する" }).click();
  await page.locator("#code").waitFor();
  await enterCode("123456");
  await page.getByText("コードが無効か").waitFor({ timeout: 8000 });
  log("登録されていないアドレスでも同じ案内・同じエラー（列挙対策）", true);
} catch (e) {
  console.error(e);
  console.error("URL:", page.url());
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(process.exitCode ? "LOGIN CODE SMOKE TEST FAILED" : "LOGIN CODE SMOKE TEST PASSED");
