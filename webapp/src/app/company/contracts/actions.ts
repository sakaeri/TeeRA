"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManage } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import {
  createTemplate,
  updateOrDuplicateTemplate,
  deleteTemplate,
  upsertPlacementRate,
  deletePlacementRate,
  generateStaffContractFromNewTemplate,
  type TemplateInput,
} from "@/lib/domain/contracts";

type CreateTemplateInput = Omit<TemplateInput, "companyId">;

export async function createTemplateAction(input: CreateTemplateInput) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  await createTemplate({ ...input, companyId: membership.companyId });
  revalidatePath("/company/settings");
}

export async function updateTemplateAction(
  templateId: string,
  changes: Partial<CreateTemplateInput>,
  duplicateTitle?: string,
) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  await updateOrDuplicateTemplate({ templateId, changes, duplicateTitle });
  revalidatePath("/company/settings");
}

export async function deleteTemplateAction(templateId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  await deleteTemplate(templateId);
  revalidatePath("/company/settings");
}

export async function upsertPlacementRateAction(input: {
  companyRelationshipId?: string;
  taskName: string;
  wageType: "HOURLY" | "DAILY" | "MONTHLY";
  amount: number;
}) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  await upsertPlacementRate({ ...input, companyId: membership.companyId });
  revalidatePath("/company/settings");
}

export async function deletePlacementRateAction(id: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  await deletePlacementRate(id);
  revalidatePath("/company/settings");
}

export async function generateStaffContractAction(input: CreateTemplateInput, staffUserId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  const staffMembership = await prisma.companyMembership.findFirst({
    where: { userId: staffUserId, companyId: membership.companyId, role: "STAFF" },
  });
  if (!staffMembership) throw new Error("forbidden");

  await generateStaffContractFromNewTemplate({
    companyId: membership.companyId,
    staffUserId,
    templateInput: input,
  });
  revalidatePath("/company/settings");
  revalidatePath("/company");
}
