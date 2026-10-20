"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireCompanyStaffRole } from "@/lib/auth/session";
import { consentStaffContract } from "@/lib/domain/contracts";
import { updateStaffAddressPhone } from "@/lib/domain/roster";
import { prisma } from "@/lib/prisma";
import { renderContractPdf, formatConsentedAt } from "@/lib/domain/contractPdf";
import { sendContractConsentCopyEmail } from "@/lib/email";

export async function consentContractAction(
  staffContractId: string,
  companyId: string,
  party: { name: string; address: string; phoneNumber: string },
) {
  const { userId } = await requireCompanyStaffRole();
  const h = await headers();
  const contract = await consentStaffContract({
    staffContractId,
    staffUserId: userId,
    partyName: party.name,
    partyAddress: party.address,
    partyPhoneNumber: party.phoneNumber,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent"),
  });
  // 控えのPDFを本人のメールへ送る。送れなくても同意自体は成立させる
  // （送信記録が無いままになるので、会社側の同意の記録で分かる）。
  try {
    const rendered = await renderContractPdf(contract.id);
    if (rendered && contract.consentEmail && contract.consentedAt) {
      await sendContractConsentCopyEmail({
        to: contract.consentEmail,
        name: party.name,
        companyName: rendered.contract.template.company.name,
        consentedAtLabel: formatConsentedAt(contract.consentedAt),
        pdf: rendered.pdf,
      });
      await prisma.staffContract.update({ where: { id: contract.id }, data: { consentCopySentAt: new Date() } });
    }
  } catch (e) {
    console.error("[contract-consent] 控えのメールを送れませんでした", e);
  }
  // 契約同意時に入力した住所・電話番号を、社内メモの特別枠にも反映する
  // （変更前の値は普通のメモとして履歴に積まれる）。
  const membership = await prisma.companyMembership.findUniqueOrThrow({
    where: { userId_companyId: { userId, companyId } },
  });
  await updateStaffAddressPhone({
    userId,
    membershipId: membership.id,
    authorUserId: userId,
    address: party.address,
    phoneNumber: party.phoneNumber,
  });
  revalidatePath("/staff/contracts");
  revalidatePath(`/staff/contracts/${companyId}`);
}
