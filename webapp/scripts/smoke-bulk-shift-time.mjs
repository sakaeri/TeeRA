import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 「出勤時間をまとめて入力」を検証する（依頼主の画面・スマホ幅）：
// ・その日の、時間を変えられるシフトが一覧で並ぶ（派遣会社のスタッフも含む。報告済みは出ない）
// ・「全員に同じ時間を入れる」で全員に入れ、1人だけ個別に直せる
// ・保存すると時間が変わった人にだけ1回ずつ知らせる。派遣会社には1通にまとめて知らせる
// ・別のシフトと重なる人は確認してから変更する（他の人は先に保存される）

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
const logSize = () => readFileSync("/tmp/nextdev.log").length;
const logSince = (offset) => readFileSync("/tmp/nextdev.log").subarray(offset).toString();
const count = (text, needle) => text.split(needle).length - 1;

const target = new Date(Date.now() + 9 * 3600e3 + 2 * 86400e3).toISOString().slice(0, 10);
const [ty, tm, td] = target.split("-").map(Number);
const suffix = Date.now();

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const newPage = async () => (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const client = await newPage();
const agency = await newPage();
const other = await newPage();

async function registerCompany(page, person, email, companyName) {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", person);
  await page.fill("#email", email);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  return psql(`select id from "Company" where name='${companyName}';`);
}
function addUser(name, email, companyId) {
  const id = psql(
    `with ins as (insert into "User" (id, email, "passwordHash", name, "updatedAt") values (gen_random_uuid()::text, '${email}', 'x', '${name}', now()) returning id) select id from ins;`,
  );
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${id}', '${companyId}', 'STAFF');`);
  return id;
}
function addShift(companyId, staffId, { source = "INHOUSE", rel = null, start = null, end = null } = {}) {
  const undecided = start ? "false" : "true";
  return psql(
    `with ins as (insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', '${source}', ${rel ? `'${rel}'` : "null"}, 'キャディ', '${target}', ${start ? `'${start}'` : "null"}, ${end ? `'${end}'` : "null"}, false, ${undecided}, 'CONFIRMED', 'ASSIGN', now(), now()) returning id) select id from ins;`,
  );
}
const timeOf = (id) => psql(`select coalesce("startTime",'') || '-' || coalesce("endTime",'') || '-' || "isUndecided"::text from "Shift" where id='${id}';`);

try {
  const clientId = await registerCompany(client, "依頼主担当", `bulk-client-${suffix}@example.com`, `一括依頼主${suffix}`);
  const agencyId = await registerCompany(agency, "派遣担当", `bulk-agency-${suffix}@example.com`, `一括派遣${suffix}`);
  const otherId = await registerCompany(other, "別会社担当", `bulk-other-${suffix}@example.com`, `一括別会社${suffix}`);
  const agencyNotifyEmail = `bulk-agency-notify-${suffix}@example.com`;
  psql(`update "Company" set "agencyEnabled" = true, "notificationEmail"='${agencyNotifyEmail}' where id = '${agencyId}';`);
  const relId = psql(
    `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "clientCompanyId", status, "createdAt") values (gen_random_uuid()::text, '${agencyId}', '${agencyId}', '${clientId}', 'ACTIVE', now()) returning id) select id from ins;`,
  );

  // A：依頼主の自社スタッフ（プッシュあり）
  const aId = addUser("一括エー", `bulk-a-${suffix}@example.com`, clientId);
  const pushA = `https://push.invalid/bulk-a-${suffix}`;
  psql(
    `insert into "PushSubscription" (id, "userId", endpoint, p256dh, auth) values (gen_random_uuid()::text, '${aId}', '${pushA}', 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg');`,
  );
  const shiftA = addShift(clientId, aId);
  // B：依頼主の自社スタッフ（プッシュなし→メール）
  const bEmail = `bulk-b-${suffix}@example.com`;
  const shiftB = addShift(clientId, addUser("一括ビー", bEmail, clientId));
  // C：派遣会社のスタッフ（シフトは派遣会社名義）
  const cEmail = `bulk-c-${suffix}@example.com`;
  const shiftC = addShift(agencyId, addUser("一括シー", cEmail, agencyId), { source: "CLIENT", rel: relId });
  // D：依頼主の自社スタッフ。同じ日に別の会社のシフト（15:30〜）がある
  const dId = addUser("一括ディー", `bulk-d-${suffix}@example.com`, clientId);
  const shiftD = addShift(clientId, dId);
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role) values (gen_random_uuid()::text, '${dId}', '${otherId}', 'STAFF');`);
  addShift(otherId, dId, { start: "15:30", end: "20:00" });
  // E：業務報告を提出済み（まとめて入力の対象外）
  const eId = addUser("一括イー", `bulk-e-${suffix}@example.com`, clientId);
  const shiftE = addShift(clientId, eId, { start: "06:00", end: "10:00" });
  psql(
    `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "computedMinutes", "submittedAt", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${shiftE}', '${eId}', 'WORKED', 'PENDING', 240, now(), now(), now());`,
  );

  await client.goto(`http://localhost:3000/company/calendar?y=${ty}&m=${tm}`);
  await client.waitForTimeout(900);
  await client.locator("main button", { has: client.locator(`span:text-is("${td}")`) }).first().click();
  await client.waitForTimeout(500);
  const panel = client.locator("div.fixed.inset-0.z-20").last();
  await panel.getByRole("button", { name: "出勤時間をまとめて入力" }).click();
  await client.waitForTimeout(300);
  const modal = client.locator("div.fixed.inset-0.z-20").last();
  const names = await modal.locator("[data-bulk-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-bulk-row")));
  log(
    "その日の時間を変えられる人が並ぶ（派遣スタッフ含む・報告済みは出ない）",
    ["一括エー", "一括ビー", "一括シー", "一括ディー"].every((n) => names.includes(n)) && !names.includes("一括イー"),
  );
  log("派遣会社のスタッフには派遣会社名が付く", (await modal.locator('[data-bulk-row="一括シー"]').innerText()).includes(`派遣：一括派遣${suffix}`));

  // 全員に 07:00〜15:00、シーだけ 08:00 開始に直す
  for (const n of ["一括エー", "一括ビー", "一括シー", "一括ディー"]) {
    await modal.locator(`[data-bulk-row="${n}"]`).getByLabel("時間未定").uncheck();
  }
  await modal.getByLabel("全員の開始時刻").fill("07:00");
  await modal.getByLabel("全員の終了時刻").fill("15:00");
  await modal.getByRole("button", { name: "全員に入れる" }).click();
  await modal.getByLabel("一括シーさんの開始時刻").fill("08:00");
  let offset = logSize();
  await modal.getByRole("button", { name: "保存して通知する" }).click();
  await client.waitForTimeout(2500);
  let out = logSince(offset);
  log(
    "重ならない人は保存される（エー・ビー 07:00〜15:00、シーは個別に直した 08:00〜15:00）",
    timeOf(shiftA) === "07:00-15:00-false" && timeOf(shiftB) === "07:00-15:00-false" && timeOf(shiftC) === "08:00-15:00-false",
  );
  log("別のシフトと重なる人はまだ変えずに確認が出る", timeOf(shiftD) === "--true" && (await modal.innerText()).includes("15:30〜20:00 のシフトもあり"));
  log("プッシュを受け取れる人にはプッシュ通知（1回）", count(out, pushA) === 1);
  log(
    "プッシュを受け取れない人にはメール（派遣スタッフ含む）",
    out.includes(`宛先=${bEmail} 件名=【TeeRA】出勤時間が決まりました`) && out.includes(`宛先=${cEmail} 件名=【TeeRA】出勤時間が決まりました`),
  );
  log("派遣会社には「依頼主が出勤時間を変更しました」を1通", count(out, `宛先=${agencyNotifyEmail} 件名=【TeeRA】依頼主が出勤時間を変更しました`) === 1);
  log("報告済みのシフトは変わらない", timeOf(shiftE) === "06:00-10:00-false");

  offset = logSize();
  await modal.getByRole("button", { name: "このまま変更して通知する" }).click();
  await client.waitForTimeout(2000);
  out = logSince(offset);
  log("確認して続けると、重なる人も変更される", timeOf(shiftD) === "07:00-15:00-false");
  log("2回目は確認した人の分だけ送る（他の人に二重に知らせない）", !out.includes(pushA) && !out.includes(`宛先=${bEmail}`));
  log("保存が終わると画面が閉じる", (await client.getByRole("heading", { name: "出勤時間をまとめて入力" }).count()) === 0);

  console.log(process.exitCode ? "BULK SHIFT TIME SMOKE TEST HAD FAILURES" : "BULK SHIFT TIME SMOKE TEST PASSED");
} finally {
  await browser.close();
}
