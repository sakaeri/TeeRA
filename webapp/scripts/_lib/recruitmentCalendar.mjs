import { execSync } from "node:child_process";

// スタッフの募集画面はカレンダー表示。募集のある日をタップするとポップアップでその日の募集が出る。
// 募集IDからその日を調べ、月を送ってその日を開く。
export async function openRecruitmentDay(page, recruitmentId) {
  const date = execSync(
    `PGPASSWORD=postgres psql -h localhost -U postgres -d teera -t -A -c "select to_char(date, 'YYYY-MM-DD') from \\"PublicRecruitment\\" where id='${recruitmentId}';"`,
  )
    .toString()
    .trim();
  const day = page.locator(`[data-testid="rec-day-${date}"]`);
  await page.locator('[data-testid="recruitment-month"]').waitFor();
  for (let i = 0; i < 12 && (await day.count()) === 0; i++) {
    const shown = await page.locator('[data-testid="recruitment-month"]').innerText();
    const [y, m] = shown.match(/\d+/g).map(Number);
    const forward = date.slice(0, 7) > `${y}-${String(m).padStart(2, "0")}`;
    await page.getByRole("button", { name: forward ? "次の月" : "前の月" }).click();
  }
  await day.click();
  await page.locator('[data-testid="recruitment-day-popup"]').waitFor();
  return date;
}
