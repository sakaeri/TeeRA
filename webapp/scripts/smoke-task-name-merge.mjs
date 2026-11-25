import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { extractMagicLinkFromLog } from "./_lib/magicLinkAuth.mjs";

// 依頼主の業務内容をまとめる（「キャディー」→「キャディ業務」）：
// ・請求書の画面に「業務内容が分かれています」の案内が出て、そこからまとめられる
// ・単価が違う時は注意を出し、残す方の単価になる
// ・シフト・業務報告・依頼主の単価・スタッフの単価が「キャディ業務」にそろい、請求書の明細も作り直される
// ・ほかの依頼主の「キャディー」は変わらない

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
const page = await (await browser.newContext()).newPage();
const suffix = Date.now();
const companyName = `業務まとめ確認株式会社${suffix}`;
const now = new Date(Date.now() + 9 * 3600e3);
const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const month = prev.toISOString().slice(0, 7);
const day = (d) => `${month}-${String(d).padStart(2, "0")}`;

try {
  await page.goto("http://localhost:3000/register");
  await page.fill("#name", "業務まとめ管理者");
  await page.fill("#email", `merge-admin-${suffix}@example.com`);
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.goto(extractMagicLinkFromLog());
  await page.waitForURL("http://localhost:3000/register/company");
  await page.fill("#name", companyName);
  await page.click("button[type=submit]");
  await page.waitForURL("http://localhost:3000/company");
  const companyId = psql(`select id from "Company" where name='${companyName}';`);
  psql(`update "Company" set "agencyEnabled" = true where id = '${companyId}';`);
  const newRel = (name) =>
    psql(
      `with ins as (insert into "CompanyRelationship" (id, "ownerCompanyId", "agencyCompanyId", "proxyName", status, "createdAt") values (gen_random_uuid()::text, '${companyId}', '${companyId}', '${name}', 'ACTIVE', now()) returning id) select id from ins;`,
    );
  const relId = newRel("まとめゴルフ場");
  const otherRelId = newRel("ほかのゴルフ場");
  const addRate = (rel, task, amount) => {
    const rateId = psql(
      `with ins as (insert into "CompanyPlacementRate" (id, "companyId", "companyRelationshipId", "taskName", "createdAt") values (gen_random_uuid()::text, '${companyId}', '${rel}', '${task}', now()) returning id) select id from ins;`,
    );
    psql(
      `insert into "CompanyPlacementRateVersion" (id, "placementRateId", "wageType", amount, "effectiveFrom", "createdAt") values (gen_random_uuid()::text, '${rateId}', 'DAILY', ${amount}, '2020-01-01', now());`,
    );
  };
  addRate(relId, "キャディ業務", 18000);
  addRate(relId, "キャディー", 20000);
  addRate(otherRelId, "キャディー", 15000);

  const staffId = psql(
    `with ins as (insert into "User" (id, email, name, "createdAt", "updatedAt") values (gen_random_uuid()::text, 'merge-staff-${suffix}@example.com', 'まとめスタッフ', now(), now()) returning id) select id from ins;`,
  );
  // スタッフのこの依頼主での単価（キャディー）
  const staffRateId = psql(
    `with ins as (insert into "StaffTaskRate" (id, "companyId", "staffUserId", "taskName", "companyRelationshipId", "createdAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'キャディー', '${relId}', now()) returning id) select id from ins;`,
  );
  const addShift = (rel, d, task) => {
    const id = psql(
      `with ins as (insert into "Shift" (id, "companyId", "staffUserId", "companyRelationshipId", source, date, "startTime", "endTime", "taskName", "createdVia", "updatedAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', '${rel}', 'CLIENT', '${day(d)}', '08:00', '17:00', '${task}', 'ASSIGN', now()) returning id) select id from ins;`,
    );
    psql(
      `insert into "WorkReport" (id, "shiftId", "staffUserId", outcome, "computedMinutes", "approvalStatus", "submittedAt", "clockIn", "clockOut", "updatedAt") values (gen_random_uuid()::text, '${id}', '${staffId}', 'WORKED', 480, 'APPROVED', now(), '${day(d)} 08:00:00', '${day(d)} 16:00:00', now());`,
    );
    return id;
  };
  for (const d of [3, 4, 5]) addShift(relId, d, "キャディ業務");
  const oddShift = addShift(relId, 6, "キャディー");
  // 業務報告で業務内容を「キャディー」に直したもの
  const reportShift = addShift(relId, 7, "キャディ業務");
  psql(`update "WorkReport" set "taskName"='キャディー' where "shiftId"='${reportShift}';`);
  const otherShift = addShift(otherRelId, 8, "キャディー");

  const invoiceUrl = `http://localhost:3000/company/invoices?month=${month}&client=${relId}`;
  await page.goto(invoiceUrl);
  await page.waitForTimeout(1500);
  const invoiceId = psql(`select id from "Invoice" where "companyRelationshipId"='${relId}';`);
  const descriptions = () => psql(`select string_agg(description, ',' order by description) from "InvoiceLine" where "invoiceId"='${invoiceId}';`);
  log("まとめる前は明細に「キャディー」も入っている", descriptions().includes("（キャディー）"));

  const notice = page.getByTestId("task-name-split-notice");
  await notice.waitFor({ timeout: 15000 });
  log("請求書の画面に「業務内容が分かれています（…）」が出る", /キャディ業務／キャディー|キャディー／キャディ業務/.test(await notice.innerText()));
  await notice.getByRole("button", { name: "まとめる" }).click();
  const modal = page.getByTestId("task-name-merge-modal");
  await modal.waitFor();
  await modal.getByTestId("merge-from").selectOption("キャディー");
  await modal.getByTestId("merge-to").selectOption("キャディ業務");
  const preview = modal.getByTestId("merge-preview");
  await preview.waitFor();
  const previewText = await preview.innerText();
  log("まとめる前に件数を出す（シフト1件・業務報告1件）", previewText.includes("シフト1件") && previewText.includes("業務報告1件"));
  log("単価が違う時は、残す方の単価になると知らせる", previewText.includes("単価が違います") && previewText.includes("日給20,000円") && previewText.includes("日給18,000円"));
  await modal.getByRole("button", { name: "まとめる", exact: true }).click();
  await modal.waitFor({ state: "detached", timeout: 15000 });
  await page.waitForTimeout(1500);

  log("シフトの業務内容がそろう", psql(`select "taskName" from "Shift" where id='${oddShift}';`) === "キャディ業務");
  log("業務報告で直した業務内容もそろう", psql(`select "taskName" from "WorkReport" where "shiftId"='${reportShift}';`) === "キャディ業務");
  log(
    "依頼主の単価は「キャディ業務」だけになる（18,000円のまま）",
    psql(`select string_agg("taskName", ',') from "CompanyPlacementRate" where "companyRelationshipId"='${relId}';`) === "キャディ業務",
  );
  log("スタッフのこの依頼主での単価も名前がそろう", psql(`select "taskName" from "StaffTaskRate" where id='${staffRateId}';`) === "キャディ業務");
  log(
    "ほかの依頼主の「キャディー」は変わらない",
    psql(`select "taskName" from "Shift" where id='${otherShift}';`) === "キャディー" &&
      psql(`select count(*) from "CompanyPlacementRate" where "companyRelationshipId"='${otherRelId}' and "taskName"='キャディー';`) === "1",
  );
  await page.goto(invoiceUrl);
  await page.waitForTimeout(1500);
  log("請求書の明細は「キャディ業務」だけになる", !descriptions().includes("キャディー") && descriptions().split(",").length === 5);
  log("全部18,000円（残した方の単価）", psql(`select string_agg(distinct rate::text, ',') from "InvoiceLine" where "invoiceId"='${invoiceId}';`) === "18000");
  log("まとめた後は案内が消える", (await page.getByTestId("task-name-split-notice").count()) === 0);

  // 単価が無い業務内容の勤務：請求書の画面でその場で単価を入れると明細に入る
  addShift(relId, 9, "ハウス清掃");
  await page.goto(invoiceUrl);
  const fix = page.getByTestId("rate-fix-group").filter({ hasText: "ハウス清掃" });
  await fix.waitFor({ timeout: 15000 });
  log("請求書に「『ハウス清掃』の単価がまだ登録されていません」と出る", (await fix.innerText()).includes("「ハウス清掃」の単価がまだ登録されていません"));
  await fix.getByRole("button", { name: "単価を入れる" }).click();
  await fix.getByLabel("金額").fill("9000");
  log("開始日は一番古い勤務日が入っている", (await fix.locator('input[type="date"]').inputValue()) === day(9));
  await fix.getByRole("button", { name: "保存" }).click();
  await page.waitForTimeout(2000);
  await page.goto(invoiceUrl);
  await page.waitForTimeout(1500);
  log("単価を入れると、その勤務が明細に入る", descriptions().includes("（ハウス清掃）"));

  // 依頼主の単価タブからも開ける
  await page.goto(`http://localhost:3000/company/roster?client=${relId}&clientTab=rates`);
  await page.getByRole("button", { name: "業務内容をまとめる" }).first().waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "業務内容をまとめる" }).first().click();
  log("依頼主の単価タブから「業務内容をまとめる」を開ける", await page.getByTestId("task-name-merge-modal").isVisible());

  // --- スタッフの単価の名前が取引先の業務内容とずれている（「キャディ」12,000円／取引先は「キャディ業務」） ---
  await page.keyboard.press("Escape").catch(() => {});
  psql(`insert into "CompanyMembership" (id, "userId", "companyId", role, "createdAt") values (gen_random_uuid()::text, '${staffId}', '${companyId}', 'STAFF', now()) on conflict do nothing;`);
  const pricedStaffRate = psql(
    `with ins as (insert into "StaffTaskRate" (id, "companyId", "staffUserId", "taskName", "companyRelationshipId", "createdAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', 'キャディ', '${relId}', now()) returning id) select id from ins;`,
  );
  psql(
    `insert into "StaffTaskRateVersion" (id, "staffTaskRateId", "wageType", amount, "effectiveFrom", "createdAt") values (gen_random_uuid()::text, '${pricedStaffRate}', 'DAILY', 12000, '2020-01-01', now());`,
  );
  // シフトの名前（キャディ業務）の行は単価未設定（さっき「まとめる」でキャディー→キャディ業務にした行）
  log("まとめる時、単価の入っていない行は名前だけそろう", psql(`select "taskName" from "StaffTaskRate" where id='${staffRateId}';`) === "キャディ業務");
  await page.goto(`http://localhost:3000/company/roster?client=${relId}&clientTab=rates`);
  const alignNotice = page.getByTestId("staff-rate-align-notice");
  await alignNotice.waitFor({ timeout: 15000 });
  log("取引先の単価タブに「スタッフの単価で名前がずれているもの（1人分）」が出る", (await alignNotice.innerText()).includes("1人分"));
  await alignNotice.getByRole("button", { name: "取引先の名前にそろえる" }).click();
  await alignNotice.waitFor({ state: "detached", timeout: 15000 });
  const staffRates = psql(
    `select string_agg(r."taskName"||':'||coalesce((select max(amount)::text from "StaffTaskRateVersion" v where v."staffTaskRateId"=r.id),'none'), ',' order by r."taskName") from "StaffTaskRate" r where r."staffUserId"='${staffId}' and r."companyRelationshipId"='${relId}';`,
  );
  log("12,000円の行が「キャディ業務」になり、単価未設定の「キャディ業務」の行は消える", staffRates === "キャディ業務:12000");

  // スタッフ詳細：単価が入っていない業務内容はたたんで、まとめて削除できる
  psql(
    `insert into "StaffTaskRate" (id, "companyId", "staffUserId", "taskName", "companyRelationshipId", "createdAt") values (gen_random_uuid()::text, '${companyId}', '${staffId}', '古い名前', '${otherRelId}', now());`,
  );
  await page.goto("http://localhost:3000/company/roster");
  await page.getByText("まとめスタッフ").first().click();
  const panel = page.locator("div.fixed.inset-0.z-30").last();
  await panel.getByRole("button", { name: "業務内容単価", exact: true }).click();
  const unpriced = panel.getByTestId("unpriced-rates");
  await unpriced.waitFor({ timeout: 15000 });
  log("単価が入っていない業務内容は「▼ 単価が入っていない業務内容（1件）」にたたまれる", (await unpriced.innerText()).includes("単価が入っていない業務内容（1件）"));
  await unpriced.getByRole("button", { name: /単価が入っていない業務内容/ }).click();
  page.once("dialog", (d) => d.accept());
  await unpriced.getByTestId("delete-all-unpriced").click();
  await unpriced.waitFor({ state: "detached", timeout: 15000 });
  log("まとめて削除すると、単価の入っていない行が消える", psql(`select count(*) from "StaffTaskRate" where "staffUserId"='${staffId}' and "taskName"='古い名前';`) === "0");

  console.log(process.exitCode ? "TASK NAME MERGE SMOKE TEST HAD FAILURES" : "TASK NAME MERGE SMOKE TEST PASSED");
} catch (e) {
  console.error("TASK NAME MERGE SMOKE TEST FAILED", e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
