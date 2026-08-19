"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyStaffRole } from "@/lib/auth/session";
import { startStaffContract } from "@/lib/domain/contracts";

export async function startContractAction(templateId: string) {
  const { userId } = await requireCompanyStaffRole();
  await startStaffContract({ templateId, staffUserId: userId });
  revalidatePath("/staff/contracts");
}
