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
const ownerCtx = await browser.newContext();
const owner = await ownerCtx.newPage();
const counterpartCtx = await browser.newContext();
const counterpart = await counterpartCtx.newPage();

const ownerEmail = `relinv-owner-${Date.now()}@example.com`;
const counterpartEmail = `relinv-counterpart-${Date.now()}@example.com`;
const staffOwnerEmail = `relinv-staffowner-${Date.now()}@example.com`;

try {
  // --- setup: owner company ---
  await owner.goto("http://localhost:3000/register");
  await owner.fill("#name", "招待元管理者");
  await owner.fill("#email", ownerEmail);
  await owner.fill("#password", "password123");
  await owner.click("button[type=submit]");
  await owner.waitForURL("http://localhost:3000/register/company");
  await owner.fill("#name", "招待元株式会社");
  await owner.click("button[type=submit]");
  await owner.waitForURL("http://localhost:3000/company");

  // --- ① per-tab dedicated buttons; info note shown only in the empty
  // roster state (helps decide which roster to build), gone once populated ---
  await owner.goto("http://localhost:3000/company/roster");
  await owner.click("text=依頼主一覧");
  await owner.waitForTimeout(200);
  let bodyText = await owner.textContent("body");
  log("clients tab shows dedicated ＋依頼主を追加する button", bodyText.includes("＋依頼主を追加する"));
  log(
    "empty 依頼主一覧 shows the info note (helps decide which roster to build)",
    bodyText.includes("スタッフの配属先の依頼主の名簿です。依頼主ごとに請求書を作成できます。"),
  );
  log("old shared 取引先名簿を追加 button is gone", !bodyText.includes("取引先名簿を追加"));

  await owner.click("text=＋依頼主を追加する");
  await owner.waitForTimeout(200);
  bodyText = await owner.textContent("body");
  log(
    "info note is NOT duplicated inside the add-menu itself (belongs to the empty state, not per-add)",
    !bodyText.includes("スタッフの配属先の依頼主の名簿です。依頼主ごとに請求書を作成できます。仮アカウントを作成"),
  );
  await owner.click("text=＋依頼主を追加する");
  await owner.waitForTimeout(200);

  await owner.click("text=派遣会社一覧");
  await owner.waitForTimeout(200);
  bodyText = await owner.textContent("body");
  log("agencies tab shows dedicated ＋派遣会社を追加する button", bodyText.includes("＋派遣会社を追加する"));
  log(
    "empty 派遣会社一覧 shows the info note",
    bodyText.includes("自社にスタッフを派遣してくれている会社の名簿です。"),
  );

  // --- ⑨ generating an invite URL must NOT add a row to the list yet ---
  await owner.click("text=依頼主一覧");
  await owner.waitForTimeout(200);
  await owner.click("text=＋依頼主を追加する");
  await owner.waitForTimeout(200);
  bodyText = await owner.textContent("body");
  log("add-menu shows 本アカウントを招待 option", bodyText.includes("本アカウントを招待"));
  await owner.click("text=本アカウントを招待");
  await owner.waitForTimeout(200);
  bodyText = await owner.textContent("body");
  log("invite is a popup modal (not inline banner)", bodyText.includes("依頼主を招待する"));
  log(
    "modal explains the deferred-add behavior to the user",
    bodyText.includes("この会社として招待を受け取る") && bodyText.includes("依頼主として"),
  );

  await owner.getByRole("button", { name: "招待URLを発行する" }).click();
  await owner.waitForSelector('input[readonly]');
  const relationshipInviteUrl = await owner.locator('input[readonly]').inputValue();
  log("relationship invite URL generated", relationshipInviteUrl.includes("/invite/"));

  const ownerCompanyId = psql(`select id from "Company" where name='招待元株式会社' order by "createdAt" desc limit 1;`);
  const relCountAfterGenerate = Number(
    psql(`select count(*) from "CompanyRelationship" where "ownerCompanyId"='${ownerCompanyId}';`),
  );
  log("NO CompanyRelationship row created yet after just generating the URL", relCountAfterGenerate === 0);

  await owner.click("text=✕");
  await owner.waitForTimeout(200);
  await owner.reload();
  await owner.click("text=依頼主一覧");
  await owner.waitForTimeout(200);
  bodyText = await owner.textContent("body");
  log("list still shows 登録されていません (no premature row, no 仮 row)", bodyText.includes("登録されていません"));

  // --- full redemption flow: counterpart registers, creates own company, redeems ---
  await counterpart.goto(relationshipInviteUrl);
  await counterpart.click("text=アカウントを作成して参加する");
  await counterpart.fill("#name", "招待先担当者");
  await counterpart.fill("#email", counterpartEmail);
  await counterpart.fill("#password", "password123");
  await counterpart.click("button[type=submit]");
  await counterpart.waitForURL(/\/register\/company\?invite=/);
  bodyText = await counterpart.textContent("body");
  log("registering with a CLIENT_UPGRADE invite routes to company creation first", bodyText.includes("本部がありません"));

  await counterpart.fill("#name", "招待先株式会社");
  await counterpart.click("button[type=submit]");
  await counterpart.waitForURL(/\/invite\//);
  bodyText = await counterpart.textContent("body");
  log("after creating company, lands back on the invite page", bodyText.includes("この会社として招待を受け取る"));

  await counterpart.click("text=この会社として招待を受け取る");
  await counterpart.waitForURL("http://localhost:3000/company/roster");
  log("redemption redirects the counterpart to their own roster", counterpart.url().includes("/company/roster"));

  const relAfterRedeem = psql(
    `select "clientCompanyId" from "CompanyRelationship" where "ownerCompanyId"='${ownerCompanyId}' order by "createdAt" desc limit 1;`,
  );
  log("CompanyRelationship row now created only after redemption", Boolean(relAfterRedeem));

  const ownerAgencyEnabled = psql(`select "agencyEnabled" from "Company" where id='${ownerCompanyId}';`);
  log("owner company's agencyEnabled flag turned on at redemption time", ownerAgencyEnabled === "t");

  // --- owner's list now shows the real counterpart company name (not 仮) ---
  await owner.goto("http://localhost:3000/company/roster");
  await owner.click("text=依頼主一覧");
  await owner.waitForTimeout(300);
  bodyText = await owner.textContent("body");
  log("owner's 依頼主一覧 now shows the counterpart's real company name", bodyText.includes("招待先株式会社"));
  log("no (名称未設定) placeholder shown", !bodyText.includes("名称未設定"));
  log(
    "info note is gone now that the roster is no longer empty (1 entry exists)",
    !bodyText.includes("スタッフの配属先の依頼主の名簿です。依頼主ごとに請求書を作成できます。"),
  );

  // --- STAFF role is blocked from redeeming a company-relationship invite ---
  await owner.goto("http://localhost:3000/company/roster");
  await owner.click("text=派遣会社一覧");
  await owner.waitForTimeout(200);
  await owner.click("text=＋派遣会社を追加する");
  await owner.waitForTimeout(200);
  await owner.click("text=本アカウントを招待");
  await owner.waitForTimeout(200);
  await owner.getByRole("button", { name: "招待URLを発行する" }).click();
  await owner.waitForSelector('input[readonly]');
  const agencyInviteUrl = await owner.locator('input[readonly]').inputValue();
  await owner.click("text=✕");

  // register a fresh personal account, join owner's own company as STAFF via a staff invite, then try to redeem the agency-relationship invite
  await owner.goto("http://localhost:3000/company/roster");
  await owner.click("text=＋スタッフを招待する");
  await owner.click("text=本アカウントを招待");
  await owner.getByRole("button", { name: "招待URLを発行する" }).click();
  await owner.waitForSelector('input[readonly]');
  const staffInviteUrl = await owner.locator('input[readonly]').inputValue();
  await owner.click("text=✕");

  const staffCtx = await browser.newContext();
  const staffPage = await staffCtx.newPage();
  await staffPage.goto(staffInviteUrl);
  await staffPage.click("text=アカウントを作成して参加する");
  await staffPage.fill("#name", "招待元スタッフ");
  await staffPage.fill("#email", staffOwnerEmail);
  await staffPage.fill("#password", "password123");
  await staffPage.click("button[type=submit]");
  await staffPage.waitForURL(/\/invite\//);
  await staffPage.click("text=参加する");
  await staffPage.waitForURL("http://localhost:3000/staff");

  await staffPage.goto(agencyInviteUrl);
  bodyText = await staffPage.textContent("body");
  log(
    "STAFF member sees the block message when opening a company-relationship invite",
    bodyText.includes("自社の管理者/編集者のみがこの招待を受け取れます"),
  );
  await staffCtx.close();

  const relCountAgency = Number(
    psql(`select count(*) from "CompanyRelationship" where "ownerCompanyId"='${ownerCompanyId}' and "agencyCompanyId" is not null and "agencyCompanyId" != '${ownerCompanyId}';`),
  );
  log("agency relationship NOT created by the blocked STAFF attempt", relCountAgency === 0);

  // --- ⑧ agency-direction detail panel hides 契約・単価/請求明細 ---
  // Create a proxy 派遣会社 on the owner's own roster (kind="agency" from
  // the owner's perspective) and confirm its detail panel hides the
  // client-only tab/card, while the client-direction proxy (created
  // earlier under 依頼主一覧) still shows both.
  await owner.goto("http://localhost:3000/company/roster");
  await owner.click("text=派遣会社一覧");
  await owner.waitForTimeout(200);
  await owner.click("text=＋派遣会社を追加する");
  await owner.waitForTimeout(200);
  await owner.click("text=仮アカウントを作成");
  await owner.fill('input[placeholder="名称を入力"]', "仮派遣会社サンプル");
  await owner.getByRole("button", { name: "作成", exact: true }).click();
  await owner.waitForTimeout(600);
  await owner.click("text=仮派遣会社サンプル");
  await owner.waitForTimeout(300);
  bodyText = await owner.textContent("body");
  log("agency-direction panel hides 契約・単価 tab", !bodyText.includes("契約・単価"));
  log("agency-direction panel hides 請求明細 card", !bodyText.includes("請求明細"));
  log("agency-direction panel still shows 稼働数/未承認数", bodyText.includes("稼働数") && bodyText.includes("未承認数"));
  await owner.click("text=閉じる");
  await owner.waitForTimeout(200);

  // sanity: the client-direction proxy created earlier via the invite flow's
  // sibling (依頼主一覧) case should still show all 3, incl. 契約・単価.
  // We didn't create a client-direction proxy in this script, so instead
  // reuse the already-redeemed real client relationship (kind="client").
  await owner.click("text=依頼主一覧");
  await owner.waitForTimeout(300);
  await owner.click("text=招待先株式会社");
  await owner.waitForTimeout(300);
  bodyText = await owner.textContent("body");
  log("client-direction panel still shows 契約・単価 tab", bodyText.includes("契約・単価"));
  log("client-direction panel still shows 請求明細 card", bodyText.includes("請求明細"));

  console.log(process.exitCode ? "RELATIONSHIP INVITE SMOKE TEST HAD FAILURES" : "RELATIONSHIP INVITE SMOKE TEST PASSED");
} catch (err) {
  console.error("RELATIONSHIP INVITE SMOKE TEST FAILED", err);
  await owner.screenshot({ path: "/tmp/smoke-relinv-owner-failure.png" });
  await counterpart.screenshot({ path: "/tmp/smoke-relinv-counterpart-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
