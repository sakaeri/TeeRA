import { chromium } from "playwright-core";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// PDFを開く画面の検証：
// ・スマホ幅（ホーム画面に追加したアプリも同じ）ではアプリ内のPDF表示画面で開き、
//   「← 戻る」で元の画面に戻れる。全ページが表示され、「保存・共有」がある
// ・パソコン幅では今まで通り新しいタブで開くリンクのまま
// ・自分のサイトの /api/ 以外のURLは表示しない

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const suffix = Date.now();

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "PDF表示確認");
  await page.fill("#email", `pdf-viewer-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", `PDF表示株式会社${suffix}`);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");

  page.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text().slice(0, 400)); });
  await page.goto("http://localhost:3000/company/calendar");
  // PDFのボタンからシフト表を選ぶ
  await page.getByRole("button", { name: "PDF出力" }).click();
  await page.getByRole("link", { name: /シフト表（予定）/ }).click();
  await page.waitForURL(/\/pdf-view\?src=/);
  log("スマホではアプリ内のPDF表示画面で開く", page.url().includes(encodeURIComponent("/api/calendar/pdf")));
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 300)));
  await page.locator("main canvas").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(3000);
  const failed = await page.getByText("PDFを表示できませんでした").count();
  // 描画されたかを、canvasの中に白以外の画素があるかで確かめる
  const painted = await page.locator("main canvas").first().evaluate((c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) return true;
    return false;
  });
  log("PDFのページが表示される（中身が描かれている・エラーが出ていない）", failed === 0 && painted);
  log("「保存・共有」ボタンがある", await page.getByRole("button", { name: "保存・共有" }).isEnabled());
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/pdf-viewer.png` });
  await page.getByRole("button", { name: "← 戻る" }).click();
  await page.waitForURL(/\/company\/calendar/);
  log("「← 戻る」で元の画面に戻る", page.url().includes("/company/calendar"));

  // パソコン幅では新しいタブで開くリンクのまま
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("http://localhost:3000/company/calendar");
  const [popup] = await Promise.all([
    context.waitForEvent("page", { timeout: 15000 }),
    page.getByRole("button", { name: "PDF出力" }).click().then(() => page.getByRole("link", { name: /シフト表（予定）/ }).click()),
  ]);
  log("パソコンでは新しいタブで開く", Boolean(popup) && page.url().includes("/company/calendar"));
  await popup.close();

  // 自分のサイトの /api/ 以外は表示しない
  const res = await page.goto(`http://localhost:3000/pdf-view?src=${encodeURIComponent("https://example.com/a.pdf")}`);
  log("外部のURLは表示しない（404）", res.status() === 404);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(process.exitCode ? "PDF VIEWER SMOKE TEST FAILED" : "PDF VIEWER SMOKE TEST PASSED");
