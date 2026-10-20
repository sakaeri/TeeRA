"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManage, canManageAny, canManageShifts } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { getStaffTeamIds, getClientTeamIds } from "@/lib/domain/teams";
import { updateStaffAddressPhone } from "@/lib/domain/roster";
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
  generateStaffContractFromNewTemplateViaUpload,
  startStaffContractFromUpload,
  assignExistingTemplate,
  addStaffContractWageVersion,
  endStaffContract,
  type TemplateInput,
  type UploadOnlyTemplateInput,
} from "@/lib/domain/contracts";
import { createStaffNotice } from "@/lib/domain/notices";

const WAGE_TYPE_LABEL: Record<string, string> = { HOURLY: "時給", DAILY: "日給", MONTHLY: "月給" };

type CreateTemplateInput = Omit<TemplateInput, "companyId">;

export async function createTemplateAction(input: CreateTemplateInput) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  const template = await createTemplate({ ...input, companyId: membership.companyId });
  revalidatePath("/company/settings");
  revalidatePath("/company/roster");
  return template;
}

export async function updateTemplateAction(
  templateId: string,
  changes: Partial<CreateTemplateInput>,
  duplicateTitle?: string,
) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");
  await prisma.contractTemplate.findFirstOrThrow({ where: { id: templateId, companyId: membership.companyId } });

  await updateOrDuplicateTemplate({ templateId, changes, duplicateTitle });
  revalidatePath("/company/settings");
}

export async function deleteTemplateAction(templateId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");
  await prisma.contractTemplate.findFirstOrThrow({ where: { id: templateId, companyId: membership.companyId } });

  await deleteTemplate(templateId);
  revalidatePath("/company/settings");
}

// 単価は「請求する側＝派遣会社(agencyCompanyId)」だけが設定できる。
// ownerCompanyId（関係を最初に作った側）とは限らない — 依頼主が先に相手を
// 登録した場合でも、単価を設定すべきなのは常に派遣会社側であるべきなので
// agencyCompanyIdで見る（company/actions.tsのassertRelationshipAgencySide
// と同じ考え方）。
async function assertRelationshipOwned(companyId: string, companyRelationshipId?: string) {
  if (!companyRelationshipId) return;
  const rel = await prisma.companyRelationship.findFirst({
    where: { id: companyRelationshipId, agencyCompanyId: companyId },
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
  holidayAmount?: number | null; // 土日祝の単価（null＝平日と同じ）
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

type CancelRuleInput = {
  cancelPolicy: "FREE" | "FEE_AFTER_DEADLINE" | "DENY_AFTER_DEADLINE" | "NOT_ALLOWED";
  cancelDeadlineDaysBefore: number | null;
  cancelDeadlineTime: string | null;
  cancelFeeAmount: number | null;
  cancelStaffHandling: "HOLD" | "RELEASE";
};

// 入力を検証し、規定の種類に関係ない項目を落とした保存用の値にする
function normalizeCancelRule(input: CancelRuleInput) {
  const needsDeadline = input.cancelPolicy === "FEE_AFTER_DEADLINE" || input.cancelPolicy === "DENY_AFTER_DEADLINE";
  if (needsDeadline) {
    if (input.cancelDeadlineDaysBefore == null || input.cancelDeadlineDaysBefore < 0 || !/^\d{2}:\d{2}$/.test(input.cancelDeadlineTime ?? "")) {
      throw new Error("invalid_deadline");
    }
  }
  if (input.cancelPolicy === "FEE_AFTER_DEADLINE" && !(input.cancelFeeAmount && input.cancelFeeAmount > 0)) {
    throw new Error("invalid_fee");
  }
  return {
    cancelPolicy: input.cancelPolicy,
    cancelDeadlineDaysBefore: needsDeadline ? input.cancelDeadlineDaysBefore : null,
    cancelDeadlineTime: needsDeadline ? input.cancelDeadlineTime : null,
    cancelFeeAmount: input.cancelPolicy === "FEE_AFTER_DEADLINE" ? input.cancelFeeAmount : null,
    cancelStaffHandling: input.cancelStaffHandling,
  };
}

// 依頼主共通のキャンセル規定（依頼主がオーダーを取り消した時の扱い）。
export async function setClientCancelRuleAction(input: CancelRuleInput & { companyRelationshipId: string }) {
  const { membership } = await requireCompanyAdminOrEditor();
  const relationship = await prisma.companyRelationship.findFirstOrThrow({
    where: { id: input.companyRelationshipId, agencyCompanyId: membership.companyId },
  });
  const clientTeamIds = await getClientTeamIds(relationship.id);
  if (!canManageAny(membership, clientTeamIds)) throw new Error("forbidden");

  const data = normalizeCancelRule(input);
  await prisma.clientCancelRule.upsert({
    where: { companyId_companyRelationshipId: { companyId: membership.companyId, companyRelationshipId: relationship.id } },
    create: { companyId: membership.companyId, companyRelationshipId: relationship.id, ...data },
    update: data,
  });
  revalidatePath("/company/roster");
}

// 業務内容ごとのキャンセル規定（依頼主共通と違う場合だけの例外）。
export async function setPlacementCancelRuleAction(input: CancelRuleInput & { placementRateId: string }) {
  const { membership } = await requireCompanyAdminOrEditor();
  const rate = await prisma.companyPlacementRate.findFirstOrThrow({
    where: { id: input.placementRateId, companyId: membership.companyId },
  });
  const clientTeamIds = rate.companyRelationshipId ? await getClientTeamIds(rate.companyRelationshipId) : [];
  if (!canManageAny(membership, clientTeamIds)) throw new Error("forbidden");

  await prisma.companyPlacementRate.update({
    where: { id: rate.id },
    data: { cancelRuleOverride: true, ...normalizeCancelRule(input) },
  });
  revalidatePath("/company/roster");
}

// 業務内容ごとの例外をやめて、依頼主共通の規定に戻す。
export async function clearPlacementCancelRuleAction(placementRateId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  const rate = await prisma.companyPlacementRate.findFirstOrThrow({
    where: { id: placementRateId, companyId: membership.companyId },
  });
  const clientTeamIds = rate.companyRelationshipId ? await getClientTeamIds(rate.companyRelationshipId) : [];
  if (!canManageAny(membership, clientTeamIds)) throw new Error("forbidden");

  await prisma.companyPlacementRate.update({
    where: { id: rate.id },
    data: {
      cancelRuleOverride: false,
      cancelPolicy: "FREE",
      cancelDeadlineDaysBefore: null,
      cancelDeadlineTime: null,
      cancelFeeAmount: null,
      cancelStaffHandling: "HOLD",
    },
  });
  revalidatePath("/company/roster");
}

export async function addStaffTaskRateVersionAction(input: {
  staffUserId: string;
  taskName: string;
  companyRelationshipId?: string;
  wageType: "HOURLY" | "DAILY" | "MONTHLY";
  amount: number;
  holidayAmount?: number | null; // 土日祝の単価（null＝平日と同じ）
  effectiveFrom: string; // YYYY-MM-DD
}) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const staffTeamIds = await getStaffTeamIds(input.staffUserId);
  if (!canManageAny(membership, staffTeamIds)) throw new Error("forbidden");

  const staffMembership = await prisma.companyMembership.findFirst({
    where: { userId: input.staffUserId, companyId: membership.companyId, OR: [{ role: "STAFF" }, { canWorkShifts: true }] },
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
    message: `「${input.taskName}」（${workplaceLabel}）の単価が${WAGE_TYPE_LABEL[input.wageType]}${input.amount}円${
      input.holidayAmount ? `（土日祝${input.holidayAmount}円）` : ""
    }に変更されました（${input.effectiveFrom}から）`,
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
    where: { userId: staffUserId, companyId: membership.companyId, OR: [{ role: "STAFF" }, { canWorkShifts: true }] },
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

// 「アップロードのみ」経路: 既に書面で契約済みのスタッフについて、本人の
// デジタル同意を求めず、署名済み書面のURLを添えて即時ACTIVEの契約として
// 生成する。専用の軽量テンプレート（isUploadOnly=true）を新規に作る版。
export async function generateStaffContractFromUploadAction(
  input: Omit<UploadOnlyTemplateInput, "companyId">,
  staffUserId: string,
  uploadedDocumentUrl: string,
  party?: { address?: string; phoneNumber?: string },
) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const staffTeamIds = await getStaffTeamIds(staffUserId);
  if (!canManageAny(membership, staffTeamIds)) throw new Error("forbidden");

  const staffMembership = await prisma.companyMembership.findFirst({
    where: { userId: staffUserId, companyId: membership.companyId, OR: [{ role: "STAFF" }, { canWorkShifts: true }] },
  });
  if (!staffMembership) throw new Error("forbidden");

  await generateStaffContractFromNewTemplateViaUpload({
    companyId: membership.companyId,
    staffUserId,
    templateInput: input,
    uploadedDocumentUrl,
    partyAddress: party?.address,
    partyPhoneNumber: party?.phoneNumber,
  });
  // 本部が代理入力した住所・電話番号を、社内メモの特別枠にも反映する。
  if (party?.address || party?.phoneNumber) {
    await updateStaffAddressPhone({
      userId: staffUserId,
      membershipId: staffMembership.id,
      authorUserId: userId,
      address: party.address ?? "",
      phoneNumber: party.phoneNumber ?? "",
    });
  }
  revalidatePath("/company/settings");
  revalidatePath("/company");
  revalidatePath("/company/roster");
}

// 「アップロードのみ」経路のうち、既存の「アップロード用テンプレ」（同じ
// 雇用条件で前にも使ったもの）を再利用する版。
export async function assignUploadOnlyTemplateAction(
  templateId: string,
  staffUserId: string,
  uploadedDocumentUrl: string,
  party?: { address?: string; phoneNumber?: string },
) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const staffTeamIds = await getStaffTeamIds(staffUserId);
  if (!canManageAny(membership, staffTeamIds)) throw new Error("forbidden");

  await prisma.contractTemplate.findFirstOrThrow({
    where: { id: templateId, companyId: membership.companyId, isUploadOnly: true },
  });
  const staffMembership = await prisma.companyMembership.findFirst({
    where: { userId: staffUserId, companyId: membership.companyId, OR: [{ role: "STAFF" }, { canWorkShifts: true }] },
  });
  if (!staffMembership) throw new Error("forbidden");

  await startStaffContractFromUpload({
    templateId,
    staffUserId,
    uploadedDocumentUrl,
    partyAddress: party?.address,
    partyPhoneNumber: party?.phoneNumber,
  });
  // 本部が代理入力した住所・電話番号を、社内メモの特別枠にも反映する。
  if (party?.address || party?.phoneNumber) {
    await updateStaffAddressPhone({
      userId: staffUserId,
      membershipId: staffMembership.id,
      authorUserId: userId,
      address: party.address ?? "",
      phoneNumber: party.phoneNumber ?? "",
    });
  }
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
    where: { userId: staffUserId, companyId: membership.companyId, OR: [{ role: "STAFF" }, { canWorkShifts: true }] },
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
