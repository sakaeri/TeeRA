// 請求書の宛名。現場の名前と請求先の名前が違う依頼主は、請求書の画面で宛名を直せる
// （CompanyRelationship.invoiceRecipientName に保存し、翌月以降の請求書にもそのまま使う）。
// 入っていなければ依頼主の名前（本アカウントは会社名、仮アカウントは登録した名前）。
export function invoiceRecipientName(rel: {
  invoiceRecipientName?: string | null;
  proxyName?: string | null;
  clientCompany?: { name: string } | null;
}) {
  return rel.invoiceRecipientName?.trim() || rel.clientCompany?.name || rel.proxyName || "";
}
