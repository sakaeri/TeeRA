"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyStaffRole } from "@/lib/auth/session";
import { consentStaffContract } from "@/lib/domain/contracts";
import { updateStaffAddressPhone } from "@/lib/domain/roster";
import { prisma } from "@/lib/prisma";

export async function consentContractAction(
  staffContractId: string,
  companyId: string,
  party: { name: string; address: string; phoneNumber: string },
) {
  const { userId } = await requireCompanyStaffRole();
  await consentStaffContract({
    staffContractId,
    staffUserId: userId,
    partyName: party.name,
    partyAddress: party.address,
    partyPhoneNumber: party.phoneNumber,
  });
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
