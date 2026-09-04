"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManage, canManageAny, canManageShifts } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { getStaffTeamIds, getClientTeamIds } from "@/lib/domain/teams";
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
  assignExistingTemplate,
  addStaffContractWageVersion,
  endStaffContract,
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
// から呼ばれる。単価は依頼主詳細で別途設定する。自社(INHOUSE)シフトでは
// companyRelationshipIdが無いので、その場合はシフト作成中のteamIdで
// 判定する（マネージャーだけでなくリーダーもシフト作成の一環として
// ここを通れる必要がある）。
export async function registerPlacementTaskNameAction(input: { teamId?: string; companyRelationshipId?: string; taskName: string }) {
  const { membership } = await requireCompanyAdminOrEditor();
  const clientTeamIds = input.companyRelationshipId ? await getClientTeamIds(input.companyRelationshipId) : [];
  const allowed = canManageAny(membership, clientTeamIds) || canManageShifts(membership, input.teamId);
  if (!allowed) throw new Error("forbidden");
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
  const clientTeamIds = input.companyRelationshipId ? await getClientTeamIds(input.companyRelationshipId) : [];
  if (!canManageAny(membership, clientTeamIds)) throw new Error("forbidden");
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

  const rate = await prisma.companyPlacementRate.findFirstOrThrow({
    where: { id: placementRateId, companyId: membership.companyId },
  });
  const clientTeamIds = rate.companyRelationshipId ? await getClientTeamIds(rate.companyRelationshipId) : [];
  if (!canManageAny(membership, clientTeamIds)) throw new Error("forbidden");
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
  const staffTeamIds = await getStaffTeamIds(input.staffUserId);
  if (!canManageAny(membership, staffTeamIds)) throw new Error("forbidden");

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

  const rate = await prisma.staffTaskRate.findFirstOrThrow({
    where: { id: staffTaskRateId, companyId: membership.companyId },
  });
  const staffTeamIds = await getStaffTeamIds(rate.staffUserId);
  if (!canManageAny(membership, staffTeamIds)) throw new Error("forbidden");
  await deleteStaffTaskRate(rate.id);
  revalidatePath("/company/settings");
  revalidatePath("/company/roster");
}

// 基本給の改定 — 業務内容単価と同じ「上書き＋お知らせ」。契約を結び直す
// （同意）操作は不要で、即座に反映してお知らせだけを送る。
export async function updateStaffContractWageAction(staffContractId: string, wageAmount: number, effectiveFrom: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();

  const contract = await prisma.staffContract.findFirstOrThrow({
    where: { id: staffContractId, template: { companyId: membership.companyId } },
    include: { template: true },
  });
  const staffTeamIds = await getStaffTeamIds(contract.staffUserId);
  if (!canManageAny(membership, staffTeamIds)) throw new Error("forbidden");
  try {
    await addStaffContractWageVersion({
      staffContractId: contract.id,
      wageAmount,
      effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`),
      createdByUserId: userId,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "unknown" };
  }

  await createStaffNotice({
    companyId: membership.companyId,
    staffUserId: contract.staffUserId,
    message: `基本給が${WAGE_TYPE_LABEL[contract.template.wageType]}${wageAmount}円に変更されました（${effectiveFrom}から）`,
  });

  revalidatePath("/company/settings");
  revalidatePath("/company/roster");
  return { error: null };
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
  const staffTeamIds = await getStaffTeamIds(staffUserId);
  if (!canManageAny(membership, staffTeamIds)) throw new Error("forbidden");

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
  revalidatePath("/company/roster");
}

// 「そのまま契約する」: 内容を複製せず、既存テンプレート（LOCKEDでも可）を
// そのまま別のスタッフにも割り当てる。契約開始日だけ個別に指定できる。
export async function assignExistingTemplateAction(templateId: string, staffUserId: string, contractStartDate: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  const staffTeamIds = await getStaffTeamIds(staffUserId);
  if (!canManageAny(membership, staffTeamIds)) throw new Error("forbidden");

  await prisma.contractTemplate.findFirstOrThrow({ where: { id: templateId, companyId: membership.companyId } });
  const staffMembership = await prisma.companyMembership.findFirst({
    where: { userId: staffUserId, companyId: membership.companyId, role: "STAFF" },
  });
  if (!staffMembership) throw new Error("forbidden");

  await assignExistingTemplate({
    templateId,
    staffUserId,
    contractStartDate: new Date(`${contractStartDate}T00:00:00.000Z`),
  });
  revalidatePath("/company/settings");
  revalidatePath("/company");
  revalidatePath("/company/roster");
}

// 契約満了・退職などで契約を終了扱いにする。終了すると：
// - 給料計算は「現在ACTIVEな契約」からしか基本給を拾わなくなるため、この
//   契約はそれ以降の月次計算に使われなくなる（過去分はwageVersionsの
//   実効日で解決するため終了しても変わらない — payroll.tsの日付ベース解決を参照）
// - 期間を空けての再雇用時は、改めて契約書を生成/割り当てて本人に同意して
//   もらう（スタッフ本人による自由選択は廃止済み — contracts.tsのコメント参照）
export async function endStaffContractAction(staffContractId: string, noticeGivenAt: string | null) {
  const { membership } = await requireCompanyAdminOrEditor();

  const contract = await prisma.staffContract.findFirstOrThrow({
    where: { id: staffContractId, template: { companyId: membership.companyId } },
  });
  const staffTeamIds = await getStaffTeamIds(contract.staffUserId);
  if (!canManageAny(membership, staffTeamIds)) throw new Error("forbidden");
  await endStaffContract({ staffContractId, noticeGivenAt: noticeGivenAt ? new Date(noticeGivenAt) : null });
  revalidatePath("/company/roster");
  revalidatePath("/company");
}
