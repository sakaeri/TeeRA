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
  deleteStaffTaskRateVersion,
  moveStaffTaskRateVersion,
  endStaffTaskRate,
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
import {
  alignStaffRateName,
  alignStaffRateNames,
  findSimilarTaskNames,
  listClientTaskNames,
  listStaffRateNameMismatches,
  mergeClientTaskNames,
  taskNameMergePreview,
} from "@/lib/domain/taskNameMerge";

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

  // 新しく勤務先つきの単価を登録した時は、その勤務先に配属する（配属解除していた勤務先なら配属し直す）。
  // 既にある単価の改定（単価を変更）では配属を変えない
  const isNewRate = !(await prisma.staffTaskRate.findFirst({
    where: {
      companyId: membership.companyId,
      staffUserId: input.staffUserId,
      taskName: input.taskName,
      companyRelationshipId: input.companyRelationshipId ?? null,
    },
    select: { id: true },
  }));

  const version = await addStaffTaskRateVersion({
    ...input,
    companyId: membership.companyId,
    effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00.000Z`),
    createdByUserId: userId,
  });

  // スタッフの単価で新しく入れた業務内容（研修など）は、その勤務先の業務内容にも単価未設定で登録しておく
  // （取引先の業務内容とスタッフの単価の名前がずれないように。取引先への請求の単価は取引先の「単価」で入れる）
  if (input.companyRelationshipId) {
    await registerPlacementTaskName({
      companyId: membership.companyId,
      companyRelationshipId: input.companyRelationshipId,
      taskName: input.taskName,
    });
  }

  if (isNewRate && input.companyRelationshipId) {
    await prisma.staffPlacement.upsert({
      where: {
        staffUserId_companyRelationshipId: { staffUserId: input.staffUserId, companyRelationshipId: input.companyRelationshipId },
      },
      create: { staffUserId: input.staffUserId, companyRelationshipId: input.companyRelationshipId },
      update: { active: true, endedAt: null },
    });
  }

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

// 個別単価を「この日で終了」にする。その日以降は契約書の基本給で計算する（履歴は残る）
export async function endStaffTaskRateAction(staffTaskRateId: string, effectiveFrom: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) throw new Error("invalid_date");
  const rate = await prisma.staffTaskRate.findFirstOrThrow({
    where: { id: staffTaskRateId, companyId: membership.companyId },
  });
  const staffTeamIds = await getStaffTeamIds(rate.staffUserId);
  if (!canManageAny(membership, staffTeamIds)) throw new Error("forbidden");
  await endStaffTaskRate({
    staffTaskRateId: rate.id,
    effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`),
    createdByUserId: userId,
  });
  const workplaceLabel = rate.companyRelationshipId ? await relationshipLabel(rate.companyRelationshipId) : "勤務先問わず";
  await createStaffNotice({
    companyId: membership.companyId,
    staffUserId: rate.staffUserId,
    message: `「${rate.taskName}」（${workplaceLabel}）の個別の単価は${effectiveFrom}で終了し、以降は契約書の基本給で計算されます`,
  });
  revalidatePath("/company/settings");
  revalidatePath("/company/roster");
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

// スタッフ詳細の「業務内容を追加」で選べる業務内容：勤務先の単価に登録されている業務内容を勤務先ごとに
// （キーは companyRelationshipId、勤務先問わず（社内）は ""）
export async function listPlacementTaskNamesByWorkplaceAction(): Promise<Record<string, string[]>> {
  const { membership } = await requireCompanyAdminOrEditor();
  const rates = await prisma.companyPlacementRate.findMany({
    where: { companyId: membership.companyId },
    select: { companyRelationshipId: true, taskName: true },
    orderBy: { createdAt: "asc" },
  });
  const map: Record<string, string[]> = {};
  for (const r of rates) {
    const key = r.companyRelationshipId ?? "";
    map[key] = map[key] ?? [];
    if (!map[key].includes(r.taskName)) map[key].push(r.taskName);
  }
  return map;
}

// --- 業務内容をまとめる（依頼主ごと） ---
async function assertClientAccess(companyRelationshipId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  const rel = await prisma.companyRelationship.findFirst({
    where: { id: companyRelationshipId, ownerCompanyId: membership.companyId },
    select: { id: true },
  });
  if (!rel) throw new Error("not_found");
  if (!canManageAny(membership, await getClientTeamIds(companyRelationshipId))) throw new Error("forbidden");
  return membership;
}

export async function getTaskNameMergeOptionsAction(companyRelationshipId: string) {
  const membership = await assertClientAccess(companyRelationshipId);
  const [names, rates] = await Promise.all([
    listClientTaskNames(membership.companyId, companyRelationshipId),
    prisma.companyPlacementRate.findMany({ where: { companyId: membership.companyId, companyRelationshipId }, select: { taskName: true } }),
  ]);
  // 単価に登録している名前（まとめる時に「残す方」の候補として先に選んでおく）
  return { names, similar: findSimilarTaskNames(names), rateNames: rates.map((r) => r.taskName) };
}

export async function previewTaskNameMergeAction(companyRelationshipId: string, from: string, to: string) {
  const membership = await assertClientAccess(companyRelationshipId);
  return taskNameMergePreview(membership.companyId, companyRelationshipId, String(from), String(to));
}

export async function mergeTaskNamesAction(companyRelationshipId: string, from: string, to: string) {
  const membership = await assertClientAccess(companyRelationshipId);
  await mergeClientTaskNames({ companyId: membership.companyId, companyRelationshipId, from: String(from), to: String(to) });
  revalidatePath("/company/roster");
  revalidatePath("/company/calendar");
  revalidatePath("/company/invoices");
  revalidatePath("/company/settings");
}

// --- 単価の開始日を前にずらす（給料明細・請求書の「単価の開始日より前」の案内から） ---
// 一番最初の（金額の入っている）単価の開始日を、指定した日にずらす。金額は変えない
async function moveFirstVersionStart(
  versions: { id: string; wageType: string | null; amount: number | null; effectiveFrom: Date }[],
  newFrom: string,
  update: (id: string, effectiveFrom: Date) => Promise<unknown>,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newFrom)) throw new Error("invalid_date");
  const priced = versions.filter((v) => v.wageType !== null && v.amount !== null).sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  const first = priced[0];
  const date = new Date(`${newFrom}T00:00:00.000Z`);
  if (!first || date >= first.effectiveFrom) throw new Error("not_earlier");
  await update(first.id, date);
}

export async function movePlacementRateStartAction(placementRateId: string, newFrom: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  const rate = await prisma.companyPlacementRate.findFirstOrThrow({
    where: { id: placementRateId, companyId: membership.companyId },
    include: { versions: true },
  });
  const clientTeamIds = rate.companyRelationshipId ? await getClientTeamIds(rate.companyRelationshipId) : [];
  if (!canManageAny(membership, clientTeamIds)) throw new Error("forbidden");
  await moveFirstVersionStart(rate.versions, newFrom, (id, effectiveFrom) =>
    prisma.companyPlacementRateVersion.update({ where: { id }, data: { effectiveFrom } }),
  );
  revalidatePath("/company/invoices");
  revalidatePath("/company/roster");
}

export async function moveStaffTaskRateStartAction(staffTaskRateId: string, newFrom: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  const rate = await prisma.staffTaskRate.findFirstOrThrow({
    where: { id: staffTaskRateId, companyId: membership.companyId },
    include: { versions: true },
  });
  if (!canManageAny(membership, await getStaffTeamIds(rate.staffUserId))) throw new Error("forbidden");
  await moveFirstVersionStart(rate.versions, newFrom, (id, effectiveFrom) =>
    prisma.staffTaskRateVersion.update({ where: { id }, data: { effectiveFrom } }),
  );
  revalidatePath("/company/payroll");
  revalidatePath("/company/roster");
}

// スタッフの単価の履歴を1件ずつ直す（開始日を直す・消す）。失敗した時は理由を返す
const RATE_VERSION_ERROR: Record<string, string> = {
  last_version: "最後の単価は消せません（単価ごと消す時は「削除する」を使ってください）",
  same_date: "同じ日に始まる単価が他にあります",
  invalid_date: "日付を入れてください",
  not_found: "見つかりませんでした",
};

async function staffRateForEdit(staffTaskRateId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  const rate = await prisma.staffTaskRate.findFirstOrThrow({ where: { id: staffTaskRateId, companyId: membership.companyId } });
  if (!canManageAny(membership, await getStaffTeamIds(rate.staffUserId))) throw new Error("forbidden");
  return rate;
}

function rateVersionResult(e: unknown) {
  if (e instanceof Error && RATE_VERSION_ERROR[e.message]) return { status: "error" as const, reason: RATE_VERSION_ERROR[e.message] };
  throw e;
}

export async function deleteStaffTaskRateVersionAction(staffTaskRateId: string, versionId: string) {
  const rate = await staffRateForEdit(staffTaskRateId);
  try {
    await deleteStaffTaskRateVersion(rate.id, String(versionId));
  } catch (e) {
    return rateVersionResult(e);
  }
  revalidatePath("/company/payroll");
  revalidatePath("/company/roster");
  return { status: "ok" as const };
}

export async function moveStaffTaskRateVersionAction(staffTaskRateId: string, versionId: string, newFrom: string) {
  const rate = await staffRateForEdit(staffTaskRateId);
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newFrom)) throw new Error("invalid_date");
    await moveStaffTaskRateVersion(rate.id, String(versionId), new Date(`${newFrom}T00:00:00.000Z`));
  } catch (e) {
    return rateVersionResult(e);
  }
  revalidatePath("/company/payroll");
  revalidatePath("/company/roster");
  return { status: "ok" as const };
}

// 業務内容を追加する時に、開始日より前の勤務が基本給になってしまわないかを見るための、
// その勤務先・業務内容での承認済みの勤務日（古い順）
export async function listApprovedWorkDatesAction(staffUserId: string, companyRelationshipId: string | null, taskName: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageAny(membership, await getStaffTeamIds(staffUserId))) throw new Error("forbidden");
  const name = String(taskName).trim();
  if (!name) return [];
  const reports = await prisma.workReport.findMany({
    where: {
      staffUserId,
      outcome: "WORKED",
      approvalStatus: "APPROVED",
      shift: { companyId: membership.companyId, ...(companyRelationshipId ? { companyRelationshipId } : {}) },
      OR: [{ taskName: name }, { taskName: null, shift: { taskName: name } }],
    },
    select: { shift: { select: { date: true } } },
  });
  return [...new Set(reports.map((r) => r.shift.date.toISOString().slice(0, 10)))].sort();
}

// --- スタッフの単価の名前を、取引先の業務内容の名前にそろえる ---
export async function listStaffRateNameMismatchesAction(companyRelationshipId: string) {
  const membership = await assertClientAccess(companyRelationshipId);
  return listStaffRateNameMismatches(membership.companyId, companyRelationshipId);
}

export async function alignStaffRateNamesAction(companyRelationshipId: string) {
  const membership = await assertClientAccess(companyRelationshipId);
  const count = await alignStaffRateNames(membership.companyId, companyRelationshipId);
  revalidatePath("/company/roster");
  revalidatePath("/company/payroll");
  return count;
}

export async function alignStaffRateNameAction(staffTaskRateId: string, to: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  const rate = await prisma.staffTaskRate.findFirstOrThrow({ where: { id: staffTaskRateId, companyId: membership.companyId } });
  if (!canManageAny(membership, await getStaffTeamIds(rate.staffUserId))) throw new Error("forbidden");
  await alignStaffRateName(membership.companyId, staffTaskRateId, String(to));
  revalidatePath("/company/roster");
  revalidatePath("/company/payroll");
}
