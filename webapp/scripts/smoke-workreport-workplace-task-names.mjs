import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 業務報告の業務内容は、選んでいる勤務先に紐付いているものだけ候補に出す
// ・勤務先を変えると候補も切り替わる。社内は社内の業務内容
// ・1つも無い勤務先は最初から「新しい業務内容」の入力欄が開く
// ・シフト外の勤務の報告も、選んだ勤務先の業務内容が候補になる

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
const admin = await (await browser.newContext()).newPage();
const staff = await (await browser.newContext()).newPage();
const suffix = Date.now();
const adminEmail = `wptask-admin-${suffix}@example.com`;
const staffEmail = `wptask-staff-${suffix}@example.com`;
const companyName = `業務内容候補確認株式会社${suffix}`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "業務内容候補管理者");
  await admin.fill("#email", adminEmail);
  await admin.click("button[type=submit]");
  await admin.waitForTimeout(400);
  await admin.goto(extractMagicLinkFromLog());
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", companyName);
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);

  await admin.click("text=スタッフ名簿");
  await admin.click("text=＋スタッフを追加");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector("input[readonly]");
  const inviteUrl = await admin.locator("input[readonly]").inputValue();

  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "業務内容候補スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.click("button[type=submit]");
  await staff.waitForTimeout(400);
  await staff.goto(extractMagicLinkFromLog());
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");
  const staffId = psql(`select id from "User" where email='${staffEmail.toLowerCase()}';`);

  const pastDateStr = psql(`select ((now() at time zone 'Asia/Tokyo')::date - 2)::text;`);
  const rel = (name) =>
    psql(`insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") values (gen_random_uuid()::text, '${companyId}', '${companyId}', '${name}', 'ACTIVE', now()) returning id;`);
  const relA = rel("Aゴルフ倶楽部");
  const relB = rel("B登録なし倶楽部");
  const relX = rel("X別の倶楽部");
  for (const r of [relA, relB]) psql(`insert into "StaffPlacement" (id, "staffUserId", "companyRelationshipId", active, "createdAt") values (gen_random_uuid()::text, '${staffId}', '${r}', true, now());`);
  const rate = (relId, name) =>
    psql(`insert into "CompanyPlacementRate" (id, "companyId", "companyRelationshipId", "taskName") values (gen_random_uuid()::text, '${companyId}', ${relId ? `'${relId}'` : "null"}, '${name}');`);
  rate(relA, "A業務1");
  rate(relA, "A業務2");
  rate(relX, "X業務");
  rate(null, "社内業務Z");
  psql(
    `insert into "Shift" (id, "companyId", "staffUserId", source, "companyRelationshipId", date, "startTime", "endTime", "taskName", status, "createdVia", "updatedAt") ` +
      `values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'CLIENT', '${relA}', '${pastDateStr}', '08:00', '17:00', 'A業務1', 'CONFIRMED', 'ASSIGN', now());`,
  );

  await staff.goto("http://localhost:3000/staff/timecard");
  const card = staff.locator("li", { hasText: pastDateStr }).first();
  const taskSelect = card.getByTestId("report-task-name");
  await taskSelect.waitFor({ timeout: 20000 });
  const optionsOf = async () => (await taskSelect.locator("option").allInnerTexts()).filter((t) => t !== "未選択" && !t.startsWith("＋"));
  const aOptions = await optionsOf();
  log(`勤務先（A）の業務内容だけ出る：${aOptions.join("/")}`, aOptions.join("/") === "A業務1/A業務2");

  await card.getByTestId("report-workplace").selectOption(relB);
  await staff.waitForTimeout(300);
  log("業務内容が1つも無い勤務先にすると「新しい業務内容」の入力欄が開く", (await taskSelect.count()) === 0 && (await card.getByPlaceholder("業務内容（例：キャディ業務）").isVisible()));

  await card.getByTestId("report-workplace").selectOption("");
  await taskSelect.waitFor();
  const inhouseOptions = await optionsOf();
  log(`社内にすると社内の業務内容に切り替わる：${inhouseOptions.join("/")}`, inhouseOptions.includes("社内業務Z") && !inhouseOptions.includes("A業務2") && !inhouseOptions.includes("X業務"));

  // シフト外の勤務
  await staff.goto("http://localhost:3000/staff/timecard?unscheduled=1");
  const wp = staff.getByTestId("unscheduled-workplace");
  await wp.waitFor({ timeout: 15000 });
  await wp.selectOption(relA);
  await staff.waitForTimeout(300);
  const chips = await staff.getByTestId("task-suggestions").innerText();
  const datalist = await staff.locator("#unscheduled-task-names option").evaluateAll((els) => els.map((e) => e.getAttribute("value")));
  log(`シフト外：Aの業務内容が候補に出る（${chips.replace(/\n/g, "/")}）`, chips.includes("A業務2") && !chips.includes("X業務") && !chips.includes("社内業務Z"));
  log("シフト外：入力候補（一覧）もAの業務内容だけ", datalist.join("/") === "A業務1/A業務2");
  await wp.selectOption(relB);
  await staff.waitForTimeout(300);
  log("シフト外：業務内容の無い勤務先では候補が出ない", (await staff.getByTestId("task-suggestions").count()) === 0);

  console.log(process.exitCode ? "WORKPLACE TASK NAMES SMOKE TEST HAD FAILURES" : "WORKPLACE TASK NAMES SMOKE TEST PASSED");
} catch (err) {
  console.error("WORKPLACE TASK NAMES SMOKE TEST FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
