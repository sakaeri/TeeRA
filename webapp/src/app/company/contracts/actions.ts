"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManage } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import {
  createTemplate,
  updateOrDuplicateTemplate,
  deleteTemplate,
  registerPlacementTaskName,
  addPlacementRateVersion,
  deletePlacementTaskName,
  addStaffTaskRateVersion,
  deleteStaffTaskRate,
  generateStaffContractFromNewTemplate,
  type TemplateInput,
} from "@/lib/domain/contracts";
import { createStaffNotice } from "@/lib/domain/notices";

const WAGE_TYPE_LABEL: Record<string, string> = { HOURLY: "時給", DAILY: "日給", MONTHLY: "月給" };

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

async function assertRelationshipOwned(companyId: string, companyRelationshipId?: string) {
  if (!companyRelationshipId) return;
  const rel = await prisma.companyRelationship.findFirst({
    where: { id: companyRelationshipId, ownerCompanyId: companyId },
  });
  if (!rel) throw new Error("forbidden");
}

// 業務内容の登録のみ行う（単価は付けない）— シフト作成モーダルのその場追加
// から呼ばれる。単価は依頼主詳細で別途設定する。
export async function registerPlacementTaskNameAction(input: { companyRelationshipId?: string; taskName: string }) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");
  await assertRelationshipOwned(membership.companyId, input.companyRelationshipId);

  const rate = await registerPlacementTaskName({ ...input, companyId: membership.companyId });
  revalidatePath("/company/settings");
  revalidatePath("/company/calendar");
  return rate;
}

// 新しい単価バージョンを追加する（上書きせず履歴に積む）。
export async function addPlacementRateVersionAction(input: {
  companyRelationshipId?: string;
  taskName: string;
  wageType: "HOURLY" | "DAILY" | "MONTHLY";
  amount: number;
  effectiveFrom: string; // YYYY-MM-DD
}) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");
  await assertRelationshipOwned(membership.companyId, input.companyRelationshipId);

  const version = await addPlacementRateVersion({
    ...input,
    companyId: membership.companyId,
    effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`),
    createdByUserId: userId,
  });
  revalidatePath("/company/settings");
  revalidatePath("/company/roster");
  revalidatePath("/company/calendar");
  revalidatePath("/company/invoices");
  return version;
}

export async function deletePlacementTaskNameAction(placementRateId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  const rate = await prisma.companyPlacementRate.findFirstOrThrow({
    where: { id: placementRateId, companyId: membership.companyId },
  });
  await deletePlacementTaskName(rate.id);
  revalidatePath("/company/settings");
  revalidatePath("/company/roster");
  revalidatePath("/company/calendar");
}

export async function addStaffTaskRateVersionAction(input: {
  staffUserId: string;
  taskName: string;
  companyRelationshipId?: string;
  wageType: "HOURLY" | "DAILY" | "MONTHLY";
  amount: number;
  effectiveFrom: string; // YYYY-MM-DD
}) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  const staffMembership = await prisma.companyMembership.findFirst({
    where: { userId: input.staffUserId, companyId: membership.companyId, role: "STAFF" },
  });
  if (!staffMembership) throw new Error("forbidden");
  await assertRelationshipOwned(membership.companyId, input.companyRelationshipId);

  const version = await addStaffTaskRateVersion({
    ...input,
    companyId: membership.companyId,
    effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`),
    createdByUserId: userId,
  });

  const workplaceLabel = input.companyRelationshipId
    ? await relationshipLabel(input.companyRelationshipId)
    : "勤務先問わず";
  await createStaffNotice({
    companyId: membership.companyId,
    staffUserId: input.staffUserId,
    message: `「${input.taskName}」（${workplaceLabel}）の単価が${WAGE_TYPE_LABEL[input.wageType]}${input.amount}円に変更されました（${input.effectiveFrom}から）`,
  });

  revalidatePath("/company/settings");
  revalidatePath("/company/roster");
  return version;
}

export async function deleteStaffTaskRateAction(staffTaskRateId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  const rate = await prisma.staffTaskRate.findFirstOrThrow({
    where: { id: staffTaskRateId, companyId: membership.companyId },
  });
  await deleteStaffTaskRate(rate.id);
  revalidatePath("/company/settings");
  revalidatePath("/company/roster");
}

async function relationshipLabel(companyRelationshipId: string) {
  const rel = await prisma.companyRelationship.findUnique({
    where: { id: companyRelationshipId },
    include: { clientCompany: true },
  });
  return rel?.clientCompany?.name ?? rel?.proxyName ?? "取引先";
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
