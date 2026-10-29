import { chromium } from "playwright-core";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// ホームの「よく使う操作」を検証する（スマホ幅）：
// ・ホームの上に6つの操作が並ぶ
// ・押すと、その画面で作成・追加の画面を開いた状態になる
// ・開いた後はURLの指定が消え、再読み込みしても勝手に開かない

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const suffix = Date.now();

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "よく使う操作確認");
  await page.fill("#email", `quick-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", `よく使う操作株式会社${suffix}`);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");

  const section = page.getByRole("region", { name: "よく使う操作" });
  const labels = await section.getByRole("link").allInnerTexts();
  log(
    "ホームに「よく使う操作」が6つ並ぶ",
    JSON.stringify(labels.map((l) => l.trim())) ===
      JSON.stringify(["シフトを作成", "募集を作成", "スタッフを招待", "依頼主を追加", "派遣会社を追加", "給与・請求書"]),
  );
  if (process.env.QUICK_SHOT) await page.screenshot({ path: process.env.QUICK_SHOT });

  const tap = async (label) => {
    await page.goto("http://localhost:3000/company");
    await page.getByRole("region", { name: "よく使う操作" }).getByRole("link", { name: label }).click();
    await page.waitForTimeout(1500);
  };
  const topModalText = async () => (await page.locator("div.fixed.inset-0").last().innerText().catch(() => "")) ?? "";

  await tap("シフトを作成");
  log("「シフトを作成」でカレンダーのシフト作成が開く", page.url().includes("/company/calendar") && (await topModalText()).includes("シフトを作成"));
  log("開いた後はURLの指定が消える", !page.url().includes("create="));
  await page.reload();
  await page.waitForTimeout(1200);
  log("再読み込みしても勝手に開かない", (await page.getByRole("heading", { name: "シフトを作成" }).count()) === 0);

  await tap("募集を作成");
  log("「募集を作成」でカレンダーの募集作成が開く", (await topModalText()).includes("募集を作成"));

  await tap("スタッフを招待");
  log("「スタッフを招待」で名簿の招待が開く", page.url().includes("/company/roster") && (await page.getByRole("button", { name: "招待URLを発行する" }).count()) > 0);
  log("開いた後はURLの指定が消える（名簿）", !page.url().includes("invite="));

  await tap("依頼主を追加");
  let text = await page.locator("main").innerText();
  log("「依頼主を追加」で名簿の依頼主の追加メニューが開く", text.includes("依頼主名簿") && text.includes("本アカウントを招待"));

  await tap("派遣会社を追加");
  text = await page.locator("main").innerText();
  log("「派遣会社を追加」で名簿の派遣会社の追加メニューが開く", text.includes("派遣会社名簿") && text.includes("本アカウントを招待"));

  await tap("給与・請求書");
  log("「給与・請求書」で給与・請求書の画面に移る", page.url().includes("/company/payroll"));

  console.log(process.exitCode ? "QUICK ACTIONS SMOKE TEST HAD FAILURES" : "QUICK ACTIONS SMOKE TEST PASSED");
} finally {
  await browser.close();
}
