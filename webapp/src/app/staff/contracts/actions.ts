"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyStaffRole } from "@/lib/auth/session";
import { consentStaffContract } from "@/lib/domain/contracts";

export async function consentContractAction(staffContractId: string) {
  const { userId } = await requireCompanyStaffRole();
  await consentStaffContract({ staffContractId, staffUserId: userId });
  revalidatePath("/staff/contracts");
}
