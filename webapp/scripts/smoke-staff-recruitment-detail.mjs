import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// スタッフの募集一覧の中身：
// ・公開募集を所属していないスタッフが開くと、時間（未定）・給与・その他の項目・備考・追加のお知らせが出る
// ・所属先が出した公開募集は、所属スタッフには詳細を開けない（給与・その他の項目は見えない）
// ・所属先の募集（オーダー）は、備考は出るが給与・その他の項目は出ない
// ・応募する前に確認が出る

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

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = () => browser.newContext({ viewport: { width: 390, height: 844 } });
const adminA = await (await ctx()).newPage();
const adminB = await (await ctx()).newPage();
const staffA = await (await ctx()).newPage();
const staffB = await (await ctx()).newPage();
const suffix = Date.now();

async function registerCompany(page, who, slug, name) {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", who);
  await page.fill("#email", `recdet-${slug}-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", name);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  return psql(`select id from "Company" where name='${name}';`);
}
async function inviteStaff(admin, staff, slug, name) {
  await admin.goto("http://localhost:3000/company/roster");
  await admin.getByText("＋スタッフを追加").first().click();
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", name);
  await staff.fill("#email", `recdet-${slug}-${suffix}@example.com`);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
}

try {
  const companyA = await registerCompany(adminA, "本部A", "admina", `募集元A${suffix}`);
  await registerCompany(adminB, "本部B", "adminb", `別会社B${suffix}`);
  await inviteStaff(adminA, staffA, "staffa", "所属スタッフA");
  await inviteStaff(adminB, staffB, "staffb", "よそのスタッフB");

  const extra = JSON.stringify([
    { label: "勤務地", value: "利府ゴルフ倶楽部" },
    { label: "服装", value: "白いポロシャツ" },
  ]).replace(/'/g, "''");
  const insertRec = (id, title, visibility) =>
    psql(
      `insert into "PublicRecruitment" (id, "companyId", title, date, "maxEntries", "lockedTee", status, visibility, "hourlyWage", "wageType", note, "isUndecided", "extraItems", "publishedAt", "createdAt", "updatedAt") ` +
        `values ('${id}', '${companyA}', '${title}', current_date + 5, 3, 0, 'PUBLISHED', '${visibility}', 30000, 'DAILY', '集合は7時半です', true, '${extra}'::jsonb, now(), now(), now());`,
    );
  const pubId = `recdet-pub-${suffix}`;
  const orderId = `recdet-ord-${suffix}`;
  insertRec(pubId, "イベントキャディ", "PUBLIC");
  insertRec(orderId, "通常キャディ", "ORDER");
  psql(`insert into "RecruitmentAnnouncement" (id, "publicRecruitmentId", body, notified, "createdAt") values (gen_random_uuid()::text, '${orderId}', '雨天でも実施します', false, now());`);

  // 公開募集はやめた：よそのスタッフBの一覧には、他社の公開募集もオーダーも出ない
  await staffB.goto("http://localhost:3000/staff/recruitments");
  await staffB.waitForTimeout(800);
  log("よその会社の公開募集は、所属していないスタッフの一覧に出ない", (await staffB.locator(`[data-testid="recruitment-${pubId}"]`).count()) === 0);
  log("よその会社のオーダーも出ない", (await staffB.locator(`[data-testid="recruitment-${orderId}"]`).count()) === 0);

  // 所属スタッフA：自社の公開募集は詳細を開けない、オーダーは給与・その他の項目なし
  await staffA.goto("http://localhost:3000/staff/recruitments");
  const pubA = staffA.locator(`[data-testid="recruitment-${pubId}"]`);
  log("所属スタッフには自社の公開募集の詳細が開けない", await pubA.locator("button").first().isDisabled());
  const pubAText = await pubA.innerText();
  log("所属スタッフには自社の公開募集の給与・その他の項目が見えない", !pubAText.includes("30000") && !pubAText.includes("服装") && !pubAText.includes("利府"));
  const ordA = staffA.locator(`[data-testid="recruitment-${orderId}"]`);
  await ordA.locator("button").first().click();
  const ordText = await ordA.innerText();
  log("所属先の募集（オーダー）：備考は出る", ordText.includes("集合は7時半です"));
  log("所属先の募集（オーダー）：給与・その他の項目は出ない", !ordText.includes("30000") && !ordText.includes("服装"));
  log("所属先の募集（オーダー）：追加のお知らせが出る", ordText.includes("雨天でも実施します"));
  await ordA.getByRole("button", { name: "応募する" }).click();
  const confirm = staffA.locator("div.fixed.inset-0.z-40");
  log("応募する前に確認が出る", (await confirm.innerText()).includes("この募集に応募しますか？"));
  await confirm.getByRole("button", { name: "やめる" }).click();
  log("「やめる」で応募しない", psql(`select count(*) from "RecruitmentEntry" where "publicRecruitmentId"='${orderId}';`) === "0");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(process.exitCode ? "STAFF RECRUITMENT DETAIL SMOKE TEST FAILED" : "STAFF RECRUITMENT DETAIL SMOKE TEST PASSED");
