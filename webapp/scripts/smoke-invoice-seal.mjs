import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 請求書の電子印を検証する：
// ・設定で印鑑の画像を選ぶと、白背景が透過されたPNGとして保存される
// ・請求書PDFに印の画像が入る
// ・発行済みの請求書は発行時点の印（スナップショット）を使う
// ・削除できる

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

// 白い紙に朱色の丸印を押して撮ったような画像（JPEG、背景は白）
const sealFile = `/tmp/smoke-seal-${Date.now()}.jpg`;
execSync(
  `convert -size 400x400 xc:white -fill none -stroke "#c8102e" -strokewidth 18 -draw "circle 200,200 200,60" -fill "#c8102e" -stroke none -draw "rectangle 170,150 230,250" ${sealFile}`,
);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext()).newPage();
const suffix = Date.now();
const companyName = `電子印確認株式会社${suffix}`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "電子印管理者");
  await page.fill("#email", `seal-admin-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  psql(`update "Company" set "agencyEnabled" = true where id = '${companyId}';`);
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") values (gen_random_uuid()::text, '${companyId}', '${companyId}', '電子印確認ゴルフ場', 'ACTIVE', now()) returning id) select id from ins;`,
  );

  // --- 設定で印鑑の画像を選んで保存 ---
  await page.goto("http://localhost:3000/company/settings");
  await page.waitForTimeout(800);
  const section = page.locator("section, div").filter({ hasText: /^電子印（請求書）/ }).first();
  await page.locator('input[type=file][accept="image/*"]').first().setInputFiles(sealFile);
  await page.waitForTimeout(800);
  log("選んだ画像のプレビューが出る", (await page.locator('img[alt="電子印"]').count()) === 1);
  await page.getByRole("button", { name: "この印で保存する" }).click();
  await page.waitForTimeout(1000);
  const saved = psql(`select "sealImageDataUrl" from "Company" where id='${companyId}';`);
  log("PNGのdata URLとして保存される", saved.startsWith("data:image/png;base64,"));
  const pixels = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const corner = ctx.getImageData(0, 0, 1, 1).data;
    const ring = ctx.getImageData(Math.floor(img.width / 2), 2, 1, 1).data;
    return { corner: Array.from(corner), ring: Array.from(ring), width: img.width, height: img.height };
  }, saved);
  log("白い背景は透明になる（角が透明）", pixels.corner[3] === 0);
  log("朱色の部分は残る", pixels.ring[3] > 200 && pixels.ring[0] > 150);
  log("余白が切り詰められ300px以内に縮む", Math.max(pixels.width, pixels.height) <= 300);
  void section;

  // --- 請求書PDFに印が入る ---
  const month = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
  await page.goto(`http://localhost:3000/company/invoices?month=${month}&client=${relId}`);
  await page.waitForTimeout(1200);
  const invoiceId = psql(`select id from "Invoice" where "companyRelationshipId"='${relId}' limit 1;`);
  const pdf = async (query = "") => {
    const res = await page.request.get(`http://localhost:3000/api/invoices/${invoiceId}/pdf${query}`);
    return (await res.body()).toString("latin1");
  };
  log("請求書PDFに印の画像が入る", (await pdf()).includes("/Subtype /Image"));

  // --- 発行済みは発行時点の印を使う ---
  const snapshot = (withSeal) =>
    JSON.stringify({
      periodLabel: month,
      note: null,
      lines: [],
      registered: false,
      invoiceRegistrationNumber: null,
      brackets: [],
      subtotalAll: 0,
      taxAll: 0,
      total: 0,
      issuedAt: new Date().toISOString(),
      ...(withSeal ? { sealImageDataUrl: saved } : {}),
    }).replace(/'/g, "''");
  const issueWithout = psql(
    `with ins as (insert into "InvoiceIssue" (id, "invoiceId", snapshot, "issuedAt") values (gen_random_uuid()::text, '${invoiceId}', '${snapshot(false)}'::jsonb, now()) returning id) select id from ins;`,
  );
  const issueWith = psql(
    `with ins as (insert into "InvoiceIssue" (id, "invoiceId", snapshot, "issuedAt") values (gen_random_uuid()::text, '${invoiceId}', '${snapshot(true)}'::jsonb, now()) returning id) select id from ins;`,
  );
  log("印を登録する前に発行した請求書には印が出ない", !(await pdf(`?issueId=${issueWithout}`)).includes("/Subtype /Image"));
  log("印を登録した後に発行した請求書には印が出る", (await pdf(`?issueId=${issueWith}`)).includes("/Subtype /Image"));

  // --- 削除 ---
  await page.goto("http://localhost:3000/company/settings");
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "電子印を削除" }).click();
  await page.waitForTimeout(1000);
  log("電子印を削除できる", psql(`select "sealImageDataUrl" is null from "Company" where id='${companyId}';`) === "t");

  console.log(process.exitCode ? "INVOICE SEAL SMOKE TEST HAD FAILURES" : "INVOICE SEAL SMOKE TEST PASSED");
} finally {
  await browser.close();
  execSync(`rm -f ${sealFile}`);
}
