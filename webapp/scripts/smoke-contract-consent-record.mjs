import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 雇用契約書の「同意の記録」を検証する：
// ・同意した時点の内容・ハッシュ・接続元IP・端末・アカウントのメールアドレスが残る
// ・ハッシュは保存した内容と同意日時から計算し直せる（改ざんの検証ができる）
// ・控えのPDFが本人のメールに送られる
// ・本人と会社側はPDFを開ける。関係のない人は開けない
// ・会社側の契約書の詳細に「同意の記録」と「PDFで開く」が出る

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
// DBのjsonbはキーの順番を保たないので、アプリと同じくキーを並べ替えて直列化する
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const STAFF_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) SmokeTestBrowser/1.0";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();
const staff = await (
  await browser.newContext({ userAgent: STAFF_UA, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.7" } })
).newPage();
const outsider = await (await browser.newContext()).newPage();
const suffix = Date.now();
const companyName = `同意記録株式会社${suffix}`;
const staffEmail = `consent-record-staff-${suffix}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "同意記録管理者");
  await admin.fill("#email", `consent-record-admin-${suffix}@example.com`);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  await admin.goto("http://localhost:3000/company/settings?tab=contracts");
  await admin.getByRole("button", { name: "＋テンプレートを作成" }).click();
  await admin.getByText("業務内容", { exact: true }).locator("xpath=..").locator("input").fill("キャディ業務");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("select").selectOption("DAILY");
  await admin.getByText("賃金", { exact: true }).locator("xpath=..").locator("input[type=number]").fill("9000");
  await admin.getByRole("button", { name: "テンプレートを生成" }).click();
  await admin.waitForTimeout(600);

  // --- スタッフを招待して参加させる ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "記録花子");
  await staff.fill("#email", staffEmail);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffUserId = psql(`select id from "User" where email='${staffEmail}';`);

  // --- 契約書を生成 ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.reload();
  await admin.waitForTimeout(500);
  await admin.locator("tbody tr", { hasText: "記録花子" }).click();
  await admin.waitForTimeout(300);
  let panel = admin.locator("div.fixed.inset-0.z-30").first();
  await panel.getByRole("button", { name: "契約書管理" }).click();
  await panel.getByRole("button", { name: "＋契約書を追加" }).click();
  await panel.getByRole("button", { name: "契約書を生成" }).click();
  await admin.waitForTimeout(200);
  const choose = admin.locator("div.fixed.inset-0.z-30").last();
  await choose.locator("select").selectOption({ label: "アルバイト・キャディ業務" });
  await choose.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await admin.locator("div.fixed.inset-0.z-30").last().getByRole("button", { name: "このテンプレートのまま契約する" }).click();
  await admin.waitForTimeout(700);
  const contractId = psql(`select id from "StaffContract" where "staffUserId"='${staffUserId}';`);

  // --- スタッフが全文を確認して同意する ---
  await staff.goto(`http://localhost:3000/staff/contracts/${companyId}`);
  await staff.waitForTimeout(500);
  await staff.getByRole("button", { name: "契約書の全文を確認する" }).click();
  await staff.waitForTimeout(300);
  const consentModal = staff.locator("div.fixed.inset-0.z-30").last();
  await consentModal.locator('label:has-text("氏名") input').fill("記録花子");
  await consentModal.locator('label:has-text("住所") input').fill("沖縄県那覇市1-2-3");
  await consentModal.locator('label:has-text("電話番号") input').fill("090-3333-4444");
  await consentModal.getByRole("button", { name: "内容を確認しました（同意する）" }).click();
  await staff.waitForTimeout(2500);

  const row = psql(
    `select status || '|' || coalesce("consentIp",'') || '|' || coalesce("consentUserAgent",'') || '|' || coalesce("consentEmail",'') || '|' || coalesce("consentEmailVerified"::text,'') || '|' || ("consentCopySentAt" is not null) from "StaffContract" where id='${contractId}';`,
  );
  const [status, ip, ua, email, verified, copySent] = row.split("|");
  log("同意すると契約が有効になる", status === "ACTIVE");
  log("接続元IPアドレスが残る", ip === "203.0.113.7");
  log("端末・ブラウザが残る", ua === STAFF_UA);
  log("同意したアカウントのメールアドレスと確認済みであることが残る", email === staffEmail && verified === "true");

  const snapshot = JSON.parse(psql(`select "consentSnapshot"::text from "StaffContract" where id='${contractId}';`));
  log(
    "同意した時点の契約書の内容が残る（当事者・賃金・業務内容）",
    snapshot.partyName === "記録花子" &&
      snapshot.partyAddress === "沖縄県那覇市1-2-3" &&
      snapshot.rows.some((r) => r.label === "賃金" && r.value === "日給 9000円") &&
      snapshot.rows.some((r) => r.label === "業務内容" && r.value === "キャディ業務"),
  );
  const consentedAtIso = psql(
    `select to_char("consentedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from "StaffContract" where id='${contractId}';`,
  );
  const storedHash = psql(`select "consentHash" from "StaffContract" where id='${contractId}';`);
  const recomputed = createHash("sha256").update(canonicalJson({ document: snapshot, consentedAt: consentedAtIso })).digest("hex");
  log("ハッシュは保存した内容と同意日時から計算し直せる", storedHash.length === 64 && storedHash === recomputed);
  const tampered = createHash("sha256")
    .update(canonicalJson({ document: { ...snapshot, partyAddress: "別の住所" }, consentedAt: consentedAtIso }))
    .digest("hex");
  log("内容を1か所でも変えるとハッシュが一致しなくなる", tampered !== storedHash);

  const mailLog = execSync("tail -c 400000 /tmp/nextdev.log").toString();
  log(
    "控えのPDFが本人のメールに送られる",
    mailLog.includes(`宛先=${staffEmail} 件名=【TeeRA】雇用契約書の控え（${companyName}）`) && mailLog.includes("添付=雇用契約書.pdf"),
  );
  log("控えを送った記録が付く", copySent === "true");

  // --- PDF ---
  const staffPdf = await staff.request.get(`http://localhost:3000/api/contracts/${contractId}/pdf`);
  const staffPdfBody = await staffPdf.body();
  if (process.env.CONTRACT_PDF_OUT) (await import("node:fs")).writeFileSync(process.env.CONTRACT_PDF_OUT, staffPdfBody);
  log(
    "本人は契約書のPDFを開ける",
    staffPdf.status() === 200 && staffPdf.headers()["content-type"] === "application/pdf" && staffPdfBody.subarray(0, 4).toString() === "%PDF",
  );
  const adminPdf = await admin.request.get(`http://localhost:3000/api/contracts/${contractId}/pdf`);
  log("会社側も契約書のPDFを開ける", adminPdf.status() === 200 && (await adminPdf.body()).subarray(0, 4).toString() === "%PDF");

  await outsider.goto("http://localhost:3000/register");
  await outsider.fill("#name", "関係ない人");
  await outsider.fill("#email", `consent-record-outsider-${suffix}@example.com`);
  await outsider.click("button[type=submit]");
  await outsider.waitForTimeout(400);
  await outsider.goto(extractMagicLinkFromLog());
  await outsider.waitForURL("http://localhost:3000/register/company");
  await outsider.fill("#name", `関係ない株式会社${suffix}`);
  await outsider.click("button[type=submit]");
  await outsider.waitForURL("http://localhost:3000/company");
  const outsiderPdf = await outsider.request.get(`http://localhost:3000/api/contracts/${contractId}/pdf`);
  log("関係のない会社の人は開けない", outsiderPdf.status() === 403);

  // --- 会社側の契約書の詳細に同意の記録が出る ---
  await admin.goto("http://localhost:3000/company/roster");
  await admin.reload();
  await admin.waitForTimeout(500);
  await admin.locator("tbody tr", { hasText: "記録花子" }).click();
  await admin.waitForTimeout(300);
  panel = admin.locator("div.fixed.inset-0.z-30").first();
  await panel.getByRole("button", { name: "契約書管理" }).click();
  await admin.waitForTimeout(300);
  await panel.getByRole("button", { name: "詳細確認" }).first().click();
  await admin.waitForTimeout(500);
  const detail = admin.locator("div.fixed.inset-0.z-30").last();
  const detailText = await detail.innerText();
  log(
    "詳細に同意の記録（アカウント・IP・端末・控えの送信・ハッシュ）が出る",
    detailText.includes("同意の記録") &&
      detailText.includes(staffEmail) &&
      detailText.includes("203.0.113.7") &&
      detailText.includes("SmokeTestBrowser") &&
      detailText.includes("に本人へ送信") &&
      detailText.includes(storedHash),
  );
  log(
    "詳細に「PDFで開く」がある",
    (await detail.getByRole("link", { name: "PDFで開く" }).getAttribute("href")) === `/api/contracts/${contractId}/pdf`,
  );

  console.log(process.exitCode ? "CONTRACT CONSENT RECORD SMOKE TEST HAD FAILURES" : "CONTRACT CONSENT RECORD SMOKE TEST PASSED");
} finally {
  await browser.close();
}
