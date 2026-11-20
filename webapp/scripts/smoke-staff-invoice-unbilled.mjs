import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// スタッフの請求書は「請求に使ったかどうか」で判断する：
// ・前の月に請求し忘れた承認済みの勤務も、次の請求書に自動で入る（「前月以前の分を含む」）
// ・「この日までの分だけにする」で途中の日までにして出し、残りは「次の請求書を作る」で2枚目に（週払い）
// ・一度請求に使った勤務は、ほかの請求書（前の月の分を後から作っても）に入らない
// ・同じ人・同じ月の請求書は、何枚届いても開くのは1回分

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
function prevMonth() {
  const d = new Date(Date.now() + 9 * 3600e3);
  const p = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function registerCompany(page, name, email) {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "請求本部");
  await page.fill("#email", email);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", name);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  return psql(`select id from "Company" where name='${name}';`);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await (await browser.newContext()).newPage();
const staff = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const other = await (await browser.newContext()).newPage();
const suffix = Date.now();
const companyName = `未請求確認株式会社${suffix}`;
const month = prevMonth();

try {
  const companyId = await registerCompany(admin, companyName, `sinvu-admin-${suffix}@example.com`);
  psql(`update "Company" set "teeBalance"=5 where id='${companyId}';`); // 無料プラン（無料枠0）＋5Tee

  // スタッフを招待して登録
  await admin.goto("http://localhost:3000/company/roster");
  await admin.getByText("＋スタッフを追加").first().click();
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "委託太郎");
  await staff.fill("#email", `sinvu-staff-${suffix}@example.com`);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffId = psql(`select id from "User" where email='sinvu-staff-${suffix}@example.com';`);

  // 業務委託ではない間は、メニューに請求書が出ない
  await staff.goto("http://localhost:3000/staff/contracts");
  log("業務委託の契約が無い人には「請求書」が出ない", (await staff.locator('a[href="/staff/invoices"]').count()) === 0);

  // 業務委託の契約（同意済み・時給1,200円）と、先月の承認済みの勤務2件（8時間・4時間30分）
  const tpl = psql(
    `insert into "ContractTemplate" (id, "companyId", title, "employmentType", "workplaceType", "jobDescription", "scheduleType", "wageType", "wageAmount", "contractPeriodType", "contractStartDate", status, "updatedAt") values (gen_random_uuid()::text, '${companyId}', '業務委託契約', 'CONTRACTOR', 'INHOUSE', 'キャディ', 'SHIFT', 'HOURLY', 1200, 'INDEFINITE', '2026-01-01', 'LOCKED', now()) returning id;`,
  );
  const contractId = psql(
    `insert into "StaffContract" (id, "templateId", "staffUserId", "wageAmountSnapshot", "contractStartDate", status, "consentedAt", "partyName", "partyAddress", "updatedAt") values (gen_random_uuid()::text, '${tpl}', '${staffId}', 1200, '2026-01-01', 'ACTIVE', now(), '委託 太郎', '東京都千代田区1-1', now()) returning id;`,
  );
  psql(`insert into "StaffContractWageVersion" (id, "staffContractId", "wageAmount", "effectiveFrom") values (gen_random_uuid()::text, '${contractId}', 1200, '2026-01-01');`);
  psql(`update "CompanyMembership" set "bankName"='テスト銀行', "branchName"='本店', "accountType"='普通', "accountNumber"='1234567', "accountHolderName"='イタク タロウ' where "userId"='${staffId}';`);
  const addShift = (date, minutes) => {
    const shiftId = psql(
      `insert into "Shift" (id, "companyId", "staffUserId", source, "taskName", date, "startTime", "endTime", "isAllDay", "isUndecided", status, "createdVia", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'INHOUSE', 'キャディ', '${date}', '08:00', '17:00', false, false, 'CONFIRMED', 'ASSIGN', now(), now()) returning id;`,
    );
    psql(
      `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "approvalStatus", "computedMinutes", "submittedAt", "createdAt", "updatedAt") values (gen_random_uuid()::text, '${shiftId}', '${staffId}', 'WORKED', 'APPROVED', ${minutes}, now(), now(), now());`,
    );
    return shiftId;
  };
  const [my, mm] = month.split("-").map(Number);
  const earlierDate = new Date(Date.UTC(my, mm - 2, 25)).toISOString().slice(0, 10); // 前の月（請求し忘れ）
  const earlierMonth = earlierDate.slice(0, 7);
  const forgotten = addShift(earlierDate, 60);
  addShift(`${month}-05`, 60);
  addShift(`${month}-12`, 60);
  const late = addShift(`${month}-20`, 60);

  // --- 1枚目：前の月の分も自動で入る。12日までの分だけにして提出 ---
  await staff.goto(`http://localhost:3000/staff/invoices?month=${month}&newFor=${companyId}`);
  const editor = staff.getByTestId("staff-invoice-editor");
  await editor.waitFor();
  log("前の月に請求し忘れた勤務も入る（4件・前月以前の案内）", (await editor.locator("li").count()) >= 4 && (await editor.getByTestId("staff-invoice-earlier").count()) === 1);
  await staff.goto(`http://localhost:3000/staff/invoices?month=${month}&company=${companyId}&seq=1&until=${month}-12`);
  await editor.waitFor();
  const firstText = await editor.innerText();
  log("「この日までの分だけにする」で12日までの分だけになる（20日は入らない）", firstText.includes("12") && !firstText.includes(`${mm}/20`));
  staff.on("dialog", (d) => d.accept());
  await editor.getByRole("button", { name: /提出/ }).last().click();
  await staff.getByText("請求書を提出しました").waitFor();
  const first = psql(`select id||'|'||"periodRangeLabel"||'|'||jsonb_array_length("workLines") from "StaffInvoice" where "staffUserId"='${staffId}' and sequence=1;`).split("|");
  log("1枚目は3件（前月分を含む）で提出され、対象期間に「前月以前の分を含む」と残る", first[2] === "3" && first[1].includes("前月以前の分を含む"));

  // --- 2枚目：残りの勤務だけ ---
  await staff.goto(`http://localhost:3000/staff/invoices?month=${month}&company=${companyId}&seq=1`);
  await staff.getByTestId("staff-invoice-next").click();
  await editor.waitFor();
  const secondText = await editor.innerText();
  log("「次の請求書を作る」で2枚目になり、残りの20日だけが入る", (await editor.locator("li").count()) >= 1 && secondText.includes(`${mm}/20`) && !secondText.includes(`${mm}/5 `));
  await editor.getByRole("button", { name: /提出/ }).last().click();
  await staff.getByText("請求書を提出しました").waitFor();
  const second = psql(`select "workLines"::text from "StaffInvoice" where "staffUserId"='${staffId}' and sequence=2;`);
  log("2枚目には1枚目の勤務が入らない", second.includes(late) && !second.includes(forgotten));

  // --- 前の月の請求書を後から作っても、もう使った勤務は入らない ---
  await staff.goto(`http://localhost:3000/staff/invoices?month=${earlierMonth}&newFor=${companyId}`);
  await editor.waitFor();
  log("前の月の請求書を後から作っても、請求済みの勤務は入らない", (await editor.innerText()).includes("まだ請求していない承認済みの勤務はありません"));

  // --- 会社：同じ人・同じ月の請求書は、何枚届いても開くのは1回分 ---
  admin.on("dialog", (d) => d.accept());
  await admin.goto(`http://localhost:3000/company/payroll?month=${month}`);
  const list = admin.getByTestId("received-staff-invoices");
  await list.waitFor();
  log("届いた請求書の一覧に2枚目と対象期間が出る", (await list.innerText()).includes("（2枚目）") && (await list.innerText()).includes("前月以前の分を含む"));
  await list.getByRole("button", { name: /委託太郎/ }).filter({ hasNotText: "2枚目" }).click();
  await admin.waitForURL(/staffInvoice=/);
  const afterFirst = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  await admin.goto(`http://localhost:3000/company/payroll?month=${month}`);
  await admin.getByTestId("received-staff-invoices").getByRole("button", { name: /2枚目/ }).click();
  await admin.waitForURL(/staffInvoice=/);
  const afterSecond = Number(psql(`select "teeBalance" from "Company" where id='${companyId}';`));
  log("1枚目を開くと1Tee、同じ月の2枚目は無料", afterFirst === 4 && afterSecond === 4);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
console.log(process.exitCode ? "STAFF INVOICE UNBILLED SMOKE TEST FAILED" : "STAFF INVOICE UNBILLED SMOKE TEST PASSED");
