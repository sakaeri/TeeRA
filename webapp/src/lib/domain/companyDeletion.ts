import "server-only";
import { prisma } from "@/lib/prisma";

// 間違えて作った会社を、作った本人が消せるようにする（スタッフとして招待された人が、
// 自分でも会社を作ってしまい、ログインするとその会社の画面が開いてしまう時など）。
// まだ何も使っていない会社だけ消せる：管理者が本人1人だけで、スタッフ・取引先・シフト・契約書・
// 請求書・給料明細・販促品・募集が無く、Teeの購入やプランの申し込みもしていない。
export async function ownCompanyDeletable(companyId: string, userId: string) {
  const me = await prisma.companyMembership.findFirst({ where: { companyId, userId }, select: { role: true } });
  if (!me || me.role !== "COMPANY_ADMIN") return false;
  const [
    members,
    shifts,
    templates,
    owned,
    agency,
    client,
    slips,
    staffInvoices,
    invoices,
    recruitments,
    charges,
    transfers,
    subscriptions,
    promoItems,
  ] = await Promise.all([
    prisma.companyMembership.count({ where: { companyId } }),
    prisma.shift.count({ where: { companyId } }),
    prisma.contractTemplate.count({ where: { companyId } }),
    prisma.companyRelationship.count({ where: { ownerCompanyId: companyId } }),
    prisma.companyRelationship.count({ where: { agencyCompanyId: companyId } }),
    prisma.companyRelationship.count({ where: { clientCompanyId: companyId } }),
    prisma.salarySlip.count({ where: { companyId } }),
    prisma.staffInvoice.count({ where: { companyId } }),
    prisma.invoice.count({ where: { issuingCompanyId: companyId } }),
    prisma.publicRecruitment.count({ where: { companyId } }),
    prisma.stripeCharge.count({ where: { companyId } }),
    prisma.bankTransferRequest.count({ where: { companyId } }),
    prisma.stripeSubscription.count({ where: { companyId } }),
    prisma.promoItem.count({ where: { companyId } }),
  ]);
  return (
    members === 1 &&
    [shifts, templates, owned, agency, client, slips, staffInvoices, invoices, recruitments, charges, transfers, subscriptions, promoItems].every(
      (n) => n === 0,
    )
  );
}

export async function deleteOwnCompany(companyId: string, userId: string) {
  if (!(await ownCompanyDeletable(companyId, userId))) throw new Error("not_deletable");
  await prisma.company.delete({ where: { id: companyId } });
}
