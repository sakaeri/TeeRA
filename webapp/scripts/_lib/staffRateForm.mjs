// スタッフ詳細の「業務内容単価」→「＋業務内容を追加」で単価を登録するテスト用の手順。
// 画面は ①勤務先 → ②その勤務先の単価に登録されている業務内容 → ③単価 の順なので、
// 業務内容がまだ勤務先に登録されていなければ先に登録してから画面で選ぶ。
// workplace: 勤務先の名前（null なら「勤務先を問わない」）
export async function addStaffRateViaForm(page, panel, psql, { companyId, workplace = null, task, wageType, amount, holidayAmount, effectiveFrom }) {
  const relId = workplace
    ? psql(
        `select cr.id from "CompanyRelationship" cr left join "Company" c on c.id=cr."clientCompanyId" ` +
          `where cr."agencyCompanyId"='${companyId}' and (cr."proxyName"='${workplace}' or c.name='${workplace}') order by cr."createdAt" desc limit 1;`,
      ).split("\n")[0]
    : null;
  const relCond = relId ? `"companyRelationshipId"='${relId}'` : `"companyRelationshipId" is null`;
  psql(
    `insert into "CompanyPlacementRate" (id, "companyId", "companyRelationshipId", "taskName") ` +
      `select gen_random_uuid()::text, '${companyId}', ${relId ? `'${relId}'` : "null"}, '${task}' ` +
      `where not exists (select 1 from "CompanyPlacementRate" where "companyId"='${companyId}' and ${relCond} and "taskName"='${task}');`,
  );
  await panel.getByRole("button", { name: "＋業務内容を追加" }).click();
  const modal = page.locator("div.fixed.inset-0.z-40").last();
  await modal.getByTestId("new-rate-workplace").selectOption(relId ?? "");
  const taskSelect = modal.getByTestId("new-rate-task");
  await taskSelect.waitFor({ timeout: 15000 });
  await taskSelect.selectOption(task);
  if (wageType) await modal.locator("select").nth(2).selectOption(wageType);
  await modal.locator('input[placeholder="金額"]').fill(String(amount));
  if (holidayAmount) await modal.locator('input[placeholder="土日祝（任意）"]').fill(String(holidayAmount));
  if (effectiveFrom) await modal.locator('input[type="date"]').first().fill(effectiveFrom);
  await modal.getByRole("button", { name: "追加", exact: true }).click();
  await page.waitForTimeout(600);
  return relId;
}
