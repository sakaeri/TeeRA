import { chromium } from "playwright-core";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 本部・スタッフのカレンダーの月送りスワイプ：
// ・横にスワイプすると次の月（前の月）になる
// ・指が少し斜めに動いても、横スワイプ中は画面が上下に動かない
// ・縦に動かしたときは月は変わらない

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctxOpts = { viewport: { width: 390, height: 560 }, hasTouch: true, isMobile: true };
const admin = await (await browser.newContext(ctxOpts)).newPage();
const staff = await (await browser.newContext(ctxOpts)).newPage();
const suffix = Date.now();

async function swipe(page, fromX, fromY, toX, toY) {
  const cdp = await page.context().newCDPSession(page);
  const steps = 10;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: fromX, y: fromY }] });
  for (let i = 1; i <= steps; i++) {
    const x = fromX + ((toX - fromX) * i) / steps;
    const y = fromY + ((toY - fromY) * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const label = (y, m) => `${y}年${m}月`;
const nextOf = (y, m) => (m === 12 ? [y + 1, 1] : [y, m + 1]);

async function checkCalendar(page, who, url) {
  await page.goto(url);
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const [y, m] = [now.getUTCFullYear(), now.getUTCMonth() + 1];
  await page.getByText(label(y, m), { exact: true }).first().waitFor();
  // 曜日の行の位置あたりから、少し下にずれながら左へスワイプ
  const head = await page.getByText("水", { exact: true }).first().boundingBox();
  const startY = head.y + 120;
  // 少し下にスクロールした状態から始める（上下に動けば値が変わる）
  const scrollable = await page.evaluate(() => document.scrollingElement.scrollHeight - window.innerHeight);
  await page.evaluate(() => window.scrollTo(0, 30));
  await page.waitForTimeout(200);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  void scrollable;
  await swipe(page, 330, startY, 80, startY + 40);
  const [ny, nm] = nextOf(y, m);
  await page.getByText(label(ny, nm), { exact: true }).first().waitFor({ timeout: 3000 });
  log(`${who}：左にスワイプすると次の月になる`, true);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  log(`${who}：横スワイプ中は画面が上下に動かない`, scrollAfter === scrollBefore);
  await page.waitForURL(new RegExp(`m=${nm}`), { timeout: 15000 });
  // 縦に動かしたときは月は変わらない
  await page.waitForTimeout(400);
  await swipe(page, 200, startY, 215, startY - 150);
  await page.waitForTimeout(600);
  log(`${who}：縦に動かしたときは月が変わらない`, (await page.getByText(label(ny, nm), { exact: true }).count()) > 0);
}

try {
  // 本部
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "スワイプ本部");
  await admin.fill("#email", `swipe-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", `スワイプ確認${suffix}`);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  await checkCalendar(admin, "本部", "http://localhost:3000/company/calendar");

  // スタッフ
  await admin.goto("http://localhost:3000/company/roster");
  await admin.getByText("＋スタッフを追加").first().click();
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "スワイプスタッフ");
  await staff.fill("#email", `swipe-staff-${suffix}@example.com`);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  await checkCalendar(staff, "スタッフ", "http://localhost:3000/staff");
} catch (e) {
  console.error(e);
  await admin.screenshot({ path: "/tmp/smoke-swipe-admin.png" }).catch(() => {});
  await staff.screenshot({ path: "/tmp/smoke-swipe-staff.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(process.exitCode ? "CALENDAR SWIPE SMOKE TEST FAILED" : "CALENDAR SWIPE SMOKE TEST PASSED");
