import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// カレンダー：
// ・PCの幅では、絞り込み・PDF・画像のボタンに文字も出る（スマホはアイコンだけ）
// ・削除したオーダーは消えずに、その日の詳細の募集一覧のタブの下に「削除されたオーダー」として残る
//   （シフトの変更履歴とは混ぜない。スマホでも枠の中に）

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`)
    .toString()
    .split("\n")
    .filter((line) => !/^(INSERT|UPDATE|DELETE)\s/.test(line))
    .join("\n")
    .trim();
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const suffix = Date.now();
const companyName = `削除オーダー確認株式会社${suffix}`;
const now = new Date(Date.now() + 9 * 3600e3);
const y = now.getUTCFullYear();
const m = now.getUTCMonth() + 1;
const d = 20;
const day = `${y}-${String(m).padStart(2, "0")}-${d}`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "削除オーダー本部");
  await page.fill("#email", `deleted-order-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  psql(
    `insert into "PublicRecruitment" (id, "companyId", title, date, "startTime", "endTime", "maxEntries", "lockedTee", status, visibility, "createdAt", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '消したオーダー', '${day}', '08:00', '17:00', 3, 0, 'DELETED', 'ORDER', now(), now());`,
  );

  await page.goto(`http://localhost:3000/company/calendar?y=${y}&m=${m}`);
  await page.waitForTimeout(1000);

  // PCではボタンに文字も出る
  const toolbarText = await page.getByRole("button", { name: "絞り込み", exact: true }).innerText();
  log("PCの幅では絞り込みボタンに「絞り込み」と出る", toolbarText.includes("絞り込み"));
  log("PDF・画像のボタンにも文字が出る", (await page.getByRole("button", { name: "PDF出力" }).innerText()).includes("PDF") && (await page.getByRole("button", { name: "画像でシフトを共有" }).innerText()).includes("画像で共有"));

  // 削除したオーダーが日別詳細に残る
  await page.locator(`button:has(> span:text-is("${d}"))`).first().click();
  await page.waitForTimeout(600);
  const modal = page.locator("div.fixed.inset-0").last();
  log("スタッフシフトのタブ（シフトの変更履歴）には混ぜない", !(await modal.innerText()).includes("削除されたオーダー"));
  await modal.getByRole("button", { name: /募集一覧/ }).click();
  log("削除した分しか無い日も募集一覧のタブが出て、募集は無いと出る", (await modal.innerText()).includes("この日の募集はありません"));
  await modal.getByRole("button", { name: /削除されたオーダー（1件）/ }).click();
  const text = await modal.innerText();
  log("削除したオーダーが「削除されたオーダー」に残る", text.includes("消したオーダー 08:00〜17:00・3名") && text.includes("削除"));

  // スマホの幅ではアイコンだけ
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://localhost:3000/company/calendar?y=${y}&m=${m}`);
  await page.waitForTimeout(800);
  log("スマホの幅では絞り込みボタンはアイコンだけ", (await page.getByRole("button", { name: "絞り込み", exact: true }).innerText()).trim() === "");

  // スマホの幅でも、詳細の枠が細くならず、履歴が枠の中に出る（以前は枠の外にはみ出していた）
  await page.locator(`button:has(> span:text-is("${d}"))`).first().click();
  await page.waitForTimeout(600);
  const panel = page.locator("div.fixed.inset-0").last().locator("> div").first();
  const box = await panel.boundingBox();
  await panel.getByRole("button", { name: /募集一覧/ }).click();
  log("スマホの幅で日別詳細の枠が画面いっぱいに広がる", box && box.width >= 340);
  log("削除されたオーダーの履歴が詳細の枠の中に出る", (await panel.innerText()).includes("削除されたオーダー（1件）"));

  console.log(process.exitCode ? "CALENDAR DELETED ORDERS SMOKE TEST HAD FAILURES" : "CALENDAR DELETED ORDERS SMOKE TEST PASSED");
} catch (err) {
  console.error("CALENDAR DELETED ORDERS SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
