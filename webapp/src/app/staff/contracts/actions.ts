"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyStaffRole } from "@/lib/auth/session";
import { consentStaffContract } from "@/lib/domain/contracts";

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
  revalidatePath("/staff/contracts");
  revalidatePath(`/staff/contracts/${companyId}`);
}
