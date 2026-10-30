import { chromium } from "playwright-core";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// ホームの「よく使う操作」を検証する（スマホ幅）：
// ・スマホは先頭の3つが並び、見出しの「一覧で見る →」で12個全部が縦に並んだポップアップが出る
// ・PCは6個ずつ2段にそろう
// ・各画面の上の、メニュー名と同じタイトルは出さない
//   （やることリスト作成・販促品を登録はその場で開く）
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
  const visible = (await section.locator("a:visible, button:visible").allInnerTexts()).map((l) => l.trim());
  log(
    "スマホでは見出しの「一覧で見る →」と先頭の3つだけが並ぶ",
    JSON.stringify(visible) === JSON.stringify(["一覧で見る →", "シフトを作成", "募集を作成", "スタッフを招待"]),
  );
  log(
    "ヘッダーの「＋販促品を登録」「＋やることリスト作成」は無くなった",
    (await page.getByText("＋販促品を登録").count()) === 0 && (await page.getByText("＋やることリスト作成").count()) === 0,
  );
  if (process.env.QUICK_SHOT) await page.screenshot({ path: process.env.QUICK_SHOT });
  await section.getByRole("button", { name: /一覧で見る/ }).click();
  await page.waitForTimeout(300);
  const dialog = page.getByRole("dialog", { name: "よく使う操作の一覧" });
  const listed = (await dialog.locator("a, button").allInnerTexts()).map((l) => l.trim()).filter((l) => l !== "✕");
  log(
    "「一覧で見る」で12個全部が縦に並んだポップアップが出る",
    JSON.stringify(listed) ===
      JSON.stringify([
        "シフトを作成",
        "募集を作成",
        "スタッフを招待",
        "依頼主を追加",
        "派遣会社を追加",
        "契約書の雛形を作成",
        "シフトチームを作成",
        "本部メンバーを管理",
        "使い方マニュアル",
        "給与・請求書",
        "やることリスト作成",
        "販促品を登録",
      ]),
  );
  if (process.env.QUICK_SHOT) await page.screenshot({ path: process.env.QUICK_SHOT.replace(".png", "-list.png") });
  await dialog.getByRole("button", { name: "やることリスト作成" }).click();
  await page.waitForTimeout(400);
  log(
    "一覧の「やることリスト作成」で一覧が閉じ、やることリストの作成がその場で開く",
    (await dialog.count()) === 0 && (await page.getByRole("heading", { name: "やることリストを作成" }).count()) === 1,
  );
  await page.goto("http://localhost:3000/company");
  await page.getByRole("region", { name: "よく使う操作" }).getByRole("button", { name: /一覧で見る/ }).click();
  await page.getByRole("dialog", { name: "よく使う操作の一覧" }).getByRole("button", { name: "販促品を登録" }).click();
  await page.waitForTimeout(400);
  log("一覧の「販促品を登録」で販促品の登録がその場で開く", (await page.getByRole("heading", { name: /販促品を登録/ }).count()) === 1);

  // 一覧のポップアップから押す（スマホでは先頭の3つ以外は一覧の中にある）
  const tap = async (label) => {
    await page.goto("http://localhost:3000/company");
    await page.getByRole("region", { name: "よく使う操作" }).getByRole("button", { name: /一覧で見る/ }).click();
    await page.getByRole("dialog", { name: "よく使う操作の一覧" }).getByRole("link", { name: label }).click();
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

  await tap("契約書の雛形を作成");
  log(
    "「契約書の雛形を作成」で設定の契約関連が開き、テンプレートの作成が開く",
    page.url().includes("tab=contracts") && !page.url().includes("create=") && (await page.locator("div.fixed.inset-0").getByRole("heading", { name: /雇用契約書テンプレート/ }).count()) === 1,
  );
  await tap("シフトチームを作成");
  log("「シフトチームを作成」でチームの作成が開く", (await page.getByRole("heading", { name: "チームを作成" }).count()) === 1);
  await tap("本部メンバーを管理");
  log(
    "「本部メンバーを管理」で設定の本部メンバー権限に移る",
    page.url().includes("#admins") && (await page.locator("#admins").isVisible()) && (await page.locator("#admins").innerText()).includes("本部メンバー権限"),
  );
  await tap("使い方マニュアル");
  log("「使い方マニュアル」で使い方のページに移る", page.url().includes("tab=howto"));

  // --- PC：6個ずつ2段 ---
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("http://localhost:3000/company");
  await page.waitForTimeout(600);
  const tops = await page
    .getByRole("region", { name: "よく使う操作" })
    .locator("a:visible, button:visible")
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  const rows = [...new Set(tops)];
  log("PCでは12個が6個ずつ2段にそろう", tops.length === 12 && rows.length === 2 && tops.filter((t) => t === rows[0]).length === 6);
  if (process.env.QUICK_SHOT) await page.screenshot({ path: process.env.QUICK_SHOT.replace(".png", "-pc.png") });

  // --- メニュー名と同じタイトルは出さない ---
  for (const path of ["/company", "/company/calendar", "/company/roster", "/company/payroll", "/company/settings"]) {
    await page.goto(`http://localhost:3000${path}`);
    await page.waitForTimeout(500);
    log(`${path} の上にメニュー名と同じタイトルが出ない`, (await page.locator("main h1").count()) === 0);
  }

  console.log(process.exitCode ? "QUICK ACTIONS SMOKE TEST HAD FAILURES" : "QUICK ACTIONS SMOKE TEST PASSED");
} finally {
  await browser.close();
}
