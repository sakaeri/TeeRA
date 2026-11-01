// スタッフが会社に出す書類（身分証・振込先）のうち、会社が必須にしていて
// まだ出ていないもの。スタッフのホーム・アイコンの数字・契約書の同意・
// ダッシュボードで同じ判定を使う。
export type RequiredDocument = "id" | "bank";

export const REQUIRED_DOCUMENT_LABEL: Record<RequiredDocument, string> = {
  id: "身分証",
  bank: "振込先",
};

export function missingRequiredDocuments(
  membership: {
    idDocumentFrontUrl: string | null;
    idDocumentBackUrl: string | null;
    bankName: string | null;
    accountNumber: string | null;
    accountHolderName: string | null;
  },
  company: { requireIdDocument: boolean; requireBankInfo: boolean },
): RequiredDocument[] {
  const missing: RequiredDocument[] = [];
  if (company.requireIdDocument && !(membership.idDocumentFrontUrl && membership.idDocumentBackUrl)) missing.push("id");
  if (
    company.requireBankInfo &&
    !(membership.bankName?.trim() && membership.accountNumber?.trim() && membership.accountHolderName?.trim())
  ) {
    missing.push("bank");
  }
  return missing;
}
