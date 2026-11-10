// 募集の作成（ウィザード）を最後まで進める。チーム・勤務先の画面は、出た時だけ選ぶ。
// workplace: 勤務先として選ぶ依頼主の名前（省略で自社）。counts: 日付ごとの人数（選んだ日付の順）。
export async function createRecruitmentViaWizard(page, { taskName, workplace, team, counts, extraDates = [], confirm = true } = {}) {
  const modal = page.locator("div.fixed.inset-0.z-20").last();
  await modal.waitFor();
  const has = async (text) => (await modal.innerText()).includes(text);
  if (await has("どのチームの募集を作成しますか？")) {
    await (team ? modal.getByRole("button", { name: team }) : modal.locator("button").filter({ hasNotText: "✕" }).nth(1)).click();
  }
  if (await has("勤務先を選択")) {
    await modal.getByRole("button", { name: workplace ?? "自社（自社の勤務）" }).click();
  }
  await modal.getByText("業務内容を選択").waitFor();
  const existing = modal.getByRole("button", { name: taskName, exact: true });
  if (await existing.count()) {
    await existing.click();
  } else {
    if (!(await modal.getByLabel("新しい業務内容").count())) await modal.getByRole("button", { name: /新しい業務内容を追加する/ }).click();
    await modal.getByLabel("新しい業務内容").fill(taskName);
    await modal.getByRole("button", { name: "この業務内容を追加して次へ" }).click();
  }
  await modal.getByText("日付と時間").waitFor();
  // extraDates：次の月の何日を追加で選ぶか（今月の残り日数に左右されないように次の月にする）
  if (extraDates.length) {
    await modal.getByRole("button", { name: "次の月" }).click();
    for (const day of extraDates) await modal.getByRole("button", { name: String(day), exact: true }).first().click();
  }
  await modal.getByRole("button", { name: "次へ" }).click();
  await page.getByTestId("recruit-count-step").waitFor();
  if (counts) {
    const inputs = modal.locator("input[type=number]");
    for (let i = 0; i < counts.length; i++) await inputs.nth(i).fill(String(counts[i]));
  }
  await modal.getByRole("button", { name: "次へ" }).click();
  await modal.getByText("内容を確認してください").waitFor();
  if (confirm) {
    await modal.getByRole("button", { name: /件の募集を作成/ }).click();
    await page.waitForTimeout(800);
  }
  return modal;
}
