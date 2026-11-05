// スタッフの契約書の確認・同意の流れ（契約書の内容 → 身分証明書 → 振込先 → 署名）を、
// 「契約書を確認する」から開いて署名の手順まで進め、その画面（dialog）を返す。
// 身分証・振込先の手順が出たら、提出済み・入力済みの前提で「次へ」で進む。
export async function openContractSignStep(page) {
  await page.getByRole("button", { name: /契約書を確認する$/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "契約書の確認" });
  await dialog.waitFor({ timeout: 15000 });
  for (let i = 0; i < 4; i++) {
    if ((await dialog.getByRole("button", { name: "内容を確認しました（同意する）" }).count()) > 0) break;
    await dialog.getByRole("button", { name: "次へ", exact: true }).click();
    await page.waitForTimeout(300);
  }
  return dialog;
}

// 同意して、流れの画面が閉じるまで待つ
export async function submitContractConsent(page, dialog) {
  await dialog.getByRole("button", { name: "内容を確認しました（同意する）" }).click();
  await dialog.waitFor({ state: "detached", timeout: 30000 });
}
