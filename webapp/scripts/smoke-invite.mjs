import { chromium } from "playwright-core";

const [token, companyId, companyName] = process.argv[2].split("|");

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const page = await browser.newPage();
const email = `staff-smoke-${Date.now()}@example.com`;

try {
  await page.goto(`http://localhost:3000/invite/${token}`);
  console.log("invite landing:", page.url());
  const preLoginText = await page.textContent("body");
  console.log(
    "shows company name pre-login:",
    preLoginText.includes(companyName),
  );

  await page.click("text=アカウントを作成して参加する");
  await page.waitForURL(new RegExp(`/register\\?invite=${token}`));
  await page.fill("#name", "招待スタッフ");
  await page.fill("#email", email);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");

  await page.waitForURL(`http://localhost:3000/invite/${token}`, {
    timeout: 10000,
  });
  console.log("back on invite page after register:", page.url());

  await page.click("text=参加する");
  await page.waitForURL("http://localhost:3000/staff", { timeout: 10000 });
  console.log("landed on:", page.url());

  const staffPageText = await page.textContent("body");
  console.log(
    "staff page shows correct company + staff role:",
    staffPageText.includes(companyName) &&
      staffPageText.includes("スタッフとして表示中"),
  );

  console.log("INVITE SMOKE TEST PASSED");
} catch (err) {
  console.error("INVITE SMOKE TEST FAILED", err);
  await page.screenshot({ path: "/tmp/smoke-invite-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
