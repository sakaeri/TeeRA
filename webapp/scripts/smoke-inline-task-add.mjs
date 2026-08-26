import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
function psql(sql) {
  return execSync(
    `PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "${sql.replace(/"/g, '\\"')}"`,
  )
    .toString()
    .trim();
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();

const adminEmail = `inlinetask-admin-${Date.now()}@example.com`;
const staffEmail = `inlinetask-staff-${Date.now()}@example.com`;

try {
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "追加管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "追加テスト株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  // proxy client with ZERO placement rates registered yet
  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=依頼主一覧");
  await admin.waitForTimeout(200);
  await admin.click("text=＋依頼主を追加する");
  await admin.waitForTimeout(200);
  await admin.click("text=仮アカウントを作成");
  await admin.fill('input[placeholder="名称を入力"]', "新規先");
  await admin.getByRole("button", { name: "作成", exact: true }).click();
  await admin.waitForTimeout(600);

  await admin.goto("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "追加スタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  await admin.goto("http://localhost:3000/company/calendar");
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByText("シフトを作成").click();
  const modal = admin.locator("div.fixed.inset-0.z-20").last();
  await modal.getByRole("button", { name: "新規先" }).click();
  await admin.waitForTimeout(200);
  let bodyText = await modal.textContent();
  log("task step reached even with 0 existing rates", bodyText.includes("業務内容を選択"));
  log("shows the ＋新しい業務内容を追加する affordance", bodyText.includes("新しい業務内容を追加"));
  log("also offers a 選ばずに進む skip option", bodyText.includes("選ばずに進む"));

  await modal.getByRole("button", { name: /新しい業務内容を追加する/ }).click();
  await modal.locator('input[placeholder*="業務内容"]').fill("新規業務");
  await modal.locator("select").selectOption("DAILY");
  await modal.locator('input[type=number]').fill("7000");
  await modal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await admin.waitForTimeout(600);

  bodyText = await modal.textContent();
  log("advanced past the task step (now on staff selection)", bodyText.includes("スタッフを選択"));

  const rateRow = JSON.parse(
    psql(
      `select json_agg(json_build_object('taskName',"taskName",'wageType',"wageType",'amount',amount))->0 from "CompanyPlacementRate" where "taskName"='新規業務';`,
    ),
  );
  log("new CompanyPlacementRate was actually created in the DB", rateRow && rateRow.taskName === "新規業務" && rateRow.wageType === "DAILY" && Number(rateRow.amount) === 7000);

  await modal.getByRole("button", { name: "追加スタッフ" }).click();
  await modal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  bodyText = await modal.textContent();
  log("confirm screen shows the newly-created 業務内容 selected", bodyText.includes("新規業務") && bodyText.includes("日給7000円"));
  await modal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);

  const shiftId = psql(`select s.id from "Shift" s join "User" u on u.id=s."staffUserId" where u.email='${staffEmail}' order by s."createdAt" desc limit 1;`);
  const shiftRateTask = psql(
    `select r."taskName" from "Shift" s join "CompanyPlacementRate" r on r.id=s."companyPlacementRateId" where s.id='${shiftId}';`,
  );
  log("the created shift is linked to the newly-added rate", shiftRateTask === "新規業務");

  console.log(process.exitCode ? "INLINE TASK ADD SMOKE TEST HAD FAILURES" : "INLINE TASK ADD SMOKE TEST PASSED");
} catch (err) {
  console.error("INLINE TASK ADD SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-inline-task-add-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
