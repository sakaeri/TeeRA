import { chromium } from "playwright-core";

function log(label, ok) {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const adminCtx = await browser.newContext();
const admin = await adminCtx.newPage();
admin.on("console", (msg) => console.log("[admin console]", msg.type(), msg.text()));
admin.on("pageerror", (err) => console.log("[admin pageerror]", err.message));
const adminEmail = `cal-admin-${Date.now()}@example.com`;

const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();
const staffEmail = `cal-staff-${Date.now()}@example.com`;

try {
  // --- admin: register + create company
  await admin.goto("http://localhost:3000/register");
  await admin.fill("#name", "カレンダー管理者");
  await admin.fill("#email", adminEmail);
  await admin.fill("#password", "password123");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/register/company");
  await admin.fill("#name", "カレンダーテスト株式会社");
  await admin.click("button[type=submit]");
  await admin.waitForURL("http://localhost:3000/company");

  // --- admin: invite staff
  await admin.click("text=スタッフ名簿");
  await admin.waitForURL("http://localhost:3000/company/roster");
  await admin.click("text=＋スタッフを追加する");
  await admin.click("text=本アカウントを招待");
  await admin.getByRole("button", { name: "招待URLを発行する" }).click();
  await admin.waitForSelector('input[readonly]');
  const inviteUrl = await admin.locator('input[readonly]').inputValue();
  log("got staff invite url", Boolean(inviteUrl));

  // --- staff: register via invite
  await staff.goto(inviteUrl);
  await staff.click("text=アカウントを作成して参加する");
  await staff.fill("#name", "カレンダースタッフ");
  await staff.fill("#email", staffEmail);
  await staff.fill("#password", "password123");
  await staff.click("button[type=submit]");
  await staff.waitForURL(new RegExp("/invite/"));
  await staff.click("text=参加する");
  await staff.waitForURL("http://localhost:3000/staff");

  // --- staff: submit shift request for a date (day 15, taken from the
  // wizard's mini calendar grid for the currently-viewed month). The
  // request wizard is now a 4-step flow (勤務先→出勤/休み→日付/備考→確認);
  // this staff has only one company so step①(勤務先選択) is skipped.
  await staff.locator("button.fixed.bottom-8.right-8").click();
  const wizard = staff.locator("div.fixed.inset-0.z-30");
  await wizard.getByRole("button", { name: "出勤希望", exact: true }).click();
  await wizard.getByRole("button", { name: "次へ" }).click();
  await staff.waitForTimeout(200);
  await wizard.getByRole("button", { name: "15", exact: true }).click();
  await wizard.getByRole("button", { name: "次へ" }).click();
  await staff.waitForTimeout(200);
  await wizard.getByRole("button", { name: "申請する", exact: true }).click();
  await staff.waitForTimeout(800);

  // --- admin: go to calendar for Sept 2026, see pending request grouped by
  // date at the bottom, resolve it via the day-detail's ＋シフトを作成
  // (the old "マッチさせる" mini-form — which created a bare shift without
  // any task/workplace context — was retired; resolving a shift request now
  // goes through the same day-detail flow as any other assignment).
  await admin.goto("http://localhost:3000/company/calendar?y=2026&m=9");
  let calBody = await admin.textContent("body");
  log("pending shift request visible to admin", calBody.includes("カレンダースタッフ") && calBody.includes("9月15日"));

  await admin.getByRole("button", { name: "確認" }).click();
  await admin.waitForTimeout(300);
  let bodyText = await admin.textContent("body");
  log("確認で日別詳細が開き＋シフトを作成が表示される", bodyText.includes("＋シフトを作成"));

  await admin.click("text=＋シフトを作成");
  await admin.waitForTimeout(300);
  const assignModal = admin.locator("div.fixed.inset-0.z-20").last();
  await assignModal.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await assignModal.getByRole("button", { name: "＋ 新しい業務内容を追加する" }).click();
  await assignModal.locator('input[placeholder*="業務内容"]').fill("通常業務");
  await assignModal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal.getByRole("button", { name: "カレンダースタッフ" }).click();
  await assignModal.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(1000);

  // AssignShiftModal closed itself after success, but the day-detail modal for
  // day 15 underneath is still open (selectedDate never got cleared) — the
  // server action's revalidatePath already refreshed the route's data, so it
  // should now show the newly-created shift without any extra click.
  calBody = await admin.textContent("body");
  const dayDetailMatch = calBody.match(/9月15日[\s\S]{0,300}/);
  console.log("day detail snippet:", dayDetailMatch?.[0]);
  log("matched shift appears in day detail panel", Boolean(dayDetailMatch && dayDetailMatch[0].includes("カレンダースタッフ")));

  // use the admin's own authenticated browser session (a bare `fetch()` here
  // has no cookies, so it would just hit the unauthenticated response) to
  // confirm the shift request list at the bottom of the page dropped this
  // now-resolved request.
  const requestsAfterMatch = await admin.evaluate((url) => fetch(url).then((r) => r.text()), "http://localhost:3000/company/calendar?y=2026&m=9");
  log("シフト作成に伴い出勤希望が自動的に対応済みになる", requestsAfterMatch.includes("未確定の出勤希望はありません"));

  // --- admin: create an overlapping assigned shift on same day -> expect conflict
  // (the day-detail modal for this date is still open above, so its date is
  // already selected as the wizard's default date — no need to touch the mini
  // calendar. 「通常業務」は直前のシフト作成で登録済みなので、今度は選択式になる)
  await admin.locator("button", { hasText: "＋" }).last().click();
  await admin.getByRole("button", { name: "シフトを作成", exact: true }).click();
  const assignModal2 = admin.locator("div.fixed.inset-0.z-20").last();
  await assignModal2.getByRole("button", { name: "社内（自社スタッフとして勤務）" }).click();
  await admin.waitForTimeout(300);
  await assignModal2.getByRole("button", { name: "通常業務" }).click();
  const taskNextBtn = assignModal2.getByRole("button", { name: "次へ" });
  if ((await taskNextBtn.count()) > 0) await taskNextBtn.click();
  await admin.waitForTimeout(300);
  await assignModal2.getByRole("button", { name: "カレンダースタッフ" }).click();
  await assignModal2.getByRole("button", { name: "次へ" }).click();
  await admin.waitForTimeout(300);
  await assignModal2.getByRole("button", { name: /件のシフトを作成/ }).click();
  await admin.waitForTimeout(800);
  let modalBody = await admin.textContent("body");
  log("conflict detected on overlapping assign", modalBody.includes("重複している日があります"));

  await admin.getByLabel("スタッフ本人と確認済み").check();
  await admin.getByRole("button", { name: "重複を確認のうえ作成する" }).click();
  await admin.waitForTimeout(800);
  modalBody = await admin.textContent("body");
  log("override succeeded, modal closed", !modalBody.includes("重複を確認のうえ作成する"));

  console.log(process.exitCode ? "CALENDAR SMOKE TEST HAD FAILURES" : "CALENDAR SMOKE TEST PART 1 PASSED");
} catch (err) {
  console.error("CALENDAR SMOKE TEST FAILED", err);
  await admin.screenshot({ path: "/tmp/smoke-calendar-admin-failure.png" });
  await staff.screenshot({ path: "/tmp/smoke-calendar-staff-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
