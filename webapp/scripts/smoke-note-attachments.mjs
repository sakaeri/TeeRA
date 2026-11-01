import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 社内メモの添付ファイル（画像・PDF）：
// ・スタッフの社内メモに画像・PDFを付けて保存できる（5件まで）
// ・自分たちの保存場所（Vercel Blobの社内メモ用の場所）以外のURLは保存させない
// ・添付は /api/note-attachments/[id] から、メモを見られる人にだけ返す
// ・取引先の社内メモで「スタッフにも共有」したものは、配属スタッフも添付を見られる
// （このテスト環境にはVercel Blobが無いので、ブラウザからのアップロードは
//  通信を差し替えて確かめ、中身はdata: URLに置き換えて表示を確かめる）

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(`PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`)
    .toString()
    .trim()
    .split("\n")[0];
}

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG = Buffer.from(PNG_BASE64, "base64");
const PDF = Buffer.from("%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;
const PDF_DATA_URL = `data:application/pdf;base64,${PDF.toString("base64")}`;

// ブラウザからVercel Blobへのアップロードを差し替える。blobHostに返すURLのホストを変えられる
async function mockBlobUpload(page, blobHost) {
  let n = 0;
  await page.route("**/api/note-attachments/upload", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        type: "blob.generate-client-token",
        clientToken: `vercel_blob_client_teststore_${Buffer.from(JSON.stringify({ validUntil: Date.now() + 60000 })).toString("base64")}`,
      }),
    }),
  );
  await page.route(/vercel\.com\/api\/blob|blob\.vercel-storage\.com/, (route) => {
    n += 1;
    const pathname = `note-attachments/file-${n}`;
    return route.fulfill({
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        url: `https://${blobHost()}/${pathname}`,
        downloadUrl: `https://${blobHost()}/${pathname}?download=1`,
        pathname,
        contentType: "application/octet-stream",
        contentDisposition: "inline",
      }),
    });
  });
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();
const staff = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const suffix = Date.now();
const companyName = `添付確認株式会社${suffix}`;
const staffEmail = `att-staff-${suffix}@example.com`;
let blobHost = "teststore.public.blob.vercel-storage.com";

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "添付本部");
  await admin.fill("#email", `att-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "添付スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);
  const membershipId = psql(`select id from "CompanyMembership" where "userId"='${staffUserId}' and "companyId"='${companyId}';`);

  // --- スタッフの社内メモに画像とPDFを付ける ---
  await mockBlobUpload(admin, () => blobHost);
  await admin.goto("http://localhost:3000/company/roster");
  await admin.reload();
  await admin.locator("tbody tr", { hasText: "添付スタッフ" }).click();
  const panel = admin.locator("div.fixed.inset-0.z-30").first();
  await panel.getByRole("button", { name: "社内メモ" }).click();
  await panel.getByRole("button", { name: "＋メモ作成" }).click();
  let form = admin.locator("div.fixed.inset-0.z-40").last();
  log("メモ作成に「画像・PDFを添付」がある", await form.getByText("画像・PDFを添付").isVisible());

  // 6件選ぶと5件までにする
  const six = Array.from({ length: 6 }, (_, i) => ({ name: `写真${i + 1}.png`, mimeType: "image/png", buffer: PNG }));
  await form.locator('input[type="file"]').setInputFiles(six);
  await form.getByText("添付できるのは5件までです。").waitFor({ timeout: 10000 });
  await form.getByText("写真5.png").waitFor({ timeout: 10000 });
  log("6件選ぶと「5件まで」と出て、5件だけ付く", (await form.getByText("写真6.png").count()) === 0);
  // 全部外して、画像1つ＋PDF1つにする
  for (let i = 1; i <= 5; i++) await form.getByRole("button", { name: `写真${i}.pngを外す` }).click();
  await form.locator('input[type="file"]').setInputFiles([
    { name: "現場の写真.png", mimeType: "image/png", buffer: PNG },
    { name: "免許証の写し.pdf", mimeType: "application/pdf", buffer: PDF },
  ]);
  await form.getByText("免許証の写し.pdf").waitFor({ timeout: 10000 });
  await form.locator("textarea").fill("添付つきのメモ");
  await form.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(1000);
  const noteId = psql(`select id from "StaffNote" where "membershipId"='${membershipId}' and content='添付つきのメモ';`);
  log("メモと一緒に添付2件が保存される", psql(`select count(*) from "NoteAttachment" where "staffNoteId"='${noteId}';`) === "2");

  // 本文なしでも添付だけで作れる
  await panel.getByRole("button", { name: "＋メモ作成" }).click();
  form = admin.locator("div.fixed.inset-0.z-40").last();
  const createButton = form.getByRole("button", { name: "作成", exact: true });
  log("本文も添付も無いと作成できない", await createButton.isDisabled());
  await form.locator('input[type="file"]').setInputFiles([{ name: "だけ.png", mimeType: "image/png", buffer: PNG }]);
  await form.getByText("だけ.png").waitFor({ timeout: 10000 });
  await createButton.click();
  await admin.waitForTimeout(1000);
  log(
    "本文なしでも、添付があれば作れる",
    psql(`select count(*) from "StaffNote" n join "NoteAttachment" a on a."staffNoteId"=n.id where n."membershipId"='${membershipId}' and n.content='';`) === "1",
  );

  // 自分たちの保存場所以外のURLは保存させない
  blobHost = "evil.example.com";
  await panel.getByRole("button", { name: "＋メモ作成" }).click();
  form = admin.locator("div.fixed.inset-0.z-40").last();
  await form.locator("textarea").fill("よそのURLのメモ");
  await form.locator('input[type="file"]').setInputFiles([{ name: "よそ.png", mimeType: "image/png", buffer: PNG }]);
  await form.getByText("よそ.png").waitFor({ timeout: 10000 });
  await form.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(1000);
  log("よそのURLの添付は保存されない", psql(`select count(*) from "StaffNote" where content='よそのURLのメモ';`) === "0");
  await admin.keyboard.press("Escape");

  // --- 表示：中身をdata: URLにして、画像が出る・PDFが開ける ---
  psql(`update "NoteAttachment" set url='${PNG_DATA_URL}' where "staffNoteId"='${noteId}' and "contentType"='image/png';`);
  psql(`update "NoteAttachment" set url='${PDF_DATA_URL}' where "staffNoteId"='${noteId}' and "contentType"='application/pdf';`);
  const imageId = psql(`select id from "NoteAttachment" where "staffNoteId"='${noteId}' and "contentType"='image/png';`);
  const pdfId = psql(`select id from "NoteAttachment" where "staffNoteId"='${noteId}' and "contentType"='application/pdf';`);
  await admin.goto("http://localhost:3000/company/roster");
  await admin.locator("tbody tr", { hasText: "添付スタッフ" }).click();
  const panel2 = admin.locator("div.fixed.inset-0.z-30").first();
  await panel2.getByRole("button", { name: "社内メモ" }).click();
  const thumb = panel2.locator('img[alt="現場の写真.png"]');
  await thumb.waitFor({ timeout: 10000 });
  await admin.waitForFunction((el) => el.complete && el.naturalWidth > 0, await thumb.elementHandle());
  log("メモに画像が小さく表示される", true);
  await panel2.getByRole("button", { name: "現場の写真.pngを大きく表示" }).click();
  log("タップで大きく表示できる", await admin.getByRole("button", { name: "閉じる" }).last().isVisible());
  await admin.getByRole("button", { name: "閉じる" }).last().click();
  const pdfLink = panel2.locator(`a[href="/api/note-attachments/${pdfId}"]`);
  log("PDFは名前のリンクで出る", (await pdfLink.innerText()).includes("免許証の写し.pdf"));

  let res = await admin.request.get(`http://localhost:3000/api/note-attachments/${pdfId}`);
  log("本部は添付PDFを開ける", res.status() === 200 && res.headers()["content-type"] === "application/pdf");
  res = await staff.request.get(`http://localhost:3000/api/note-attachments/${imageId}`);
  log("スタッフはスタッフの社内メモの添付を見られない", res.status() === 403);

  // --- 取引先の社内メモ（スタッフにも共有）---
  const relId = `att-rel-${suffix}`;
  psql(
    `insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") values ('${relId}', '${companyId}', '${companyId}', '添付確認の現場', 'ACTIVE', now());`,
  );
  psql(
    `insert into "StaffPlacement" (id, "staffUserId", "companyRelationshipId", active, "createdAt") values (gen_random_uuid()::text, '${staffUserId}', '${relId}', true, now());`,
  );
  const adminUserId = psql(`select id from "User" where email='att-admin-${suffix}@example.com';`);
  const sharedNoteId = psql(
    `insert into "RelationshipNote" (id, "companyRelationshipId", "companyId", content, "authorUserId", "visibleToStaff", "createdAt") values (gen_random_uuid()::text, '${relId}', '${companyId}', '現場の地図です', '${adminUserId}', true, now()) returning id;`,
  );
  const privateNoteId = psql(
    `insert into "RelationshipNote" (id, "companyRelationshipId", "companyId", content, "authorUserId", "visibleToStaff", "createdAt") values (gen_random_uuid()::text, '${relId}', '${companyId}', '社内だけ', '${adminUserId}', false, now()) returning id;`,
  );
  const sharedPdfId = psql(
    `insert into "NoteAttachment" (id, "relationshipNoteId", url, "fileName", "contentType", size, "createdAt") values (gen_random_uuid()::text, '${sharedNoteId}', '${PDF_DATA_URL}', '現場の地図.pdf', 'application/pdf', 100, now()) returning id;`,
  );
  const privatePdfId = psql(
    `insert into "NoteAttachment" (id, "relationshipNoteId", url, "fileName", "contentType", size, "createdAt") values (gen_random_uuid()::text, '${privateNoteId}', '${PDF_DATA_URL}', '社内資料.pdf', 'application/pdf', 100, now()) returning id;`,
  );

  await staff.goto(`http://localhost:3000/staff/contracts/${companyId}`);
  await staff.getByRole("button", { name: /添付確認の現場/ }).first().click();
  await staff.getByText("現場の地図です").waitFor({ timeout: 10000 });
  log("スタッフの勤務先の共有メモに添付PDFが出る", (await staff.getByText("現場の地図.pdf").count()) === 1);
  log("スタッフも共有メモに画像・PDFを付けられる", await staff.getByText("画像・PDFを添付").isVisible());
  res = await staff.request.get(`http://localhost:3000/api/note-attachments/${sharedPdfId}`);
  log("配属スタッフは共有メモの添付を開ける", res.status() === 200);
  res = await staff.request.get(`http://localhost:3000/api/note-attachments/${privatePdfId}`);
  log("共有していないメモの添付はスタッフには開けない", res.status() === 403);
} catch (e) {
  console.error(e);
  await admin.screenshot({ path: "/tmp/smoke-note-attachments-admin.png" }).catch(() => {});
  await staff.screenshot({ path: "/tmp/smoke-note-attachments-staff.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(process.exitCode ? "NOTE ATTACHMENTS SMOKE TEST FAILED" : "NOTE ATTACHMENTS SMOKE TEST PASSED");
