"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManageShifts, isCompanyScopeAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import {
  createAssignedShift,
  cancelShift,
  dismissShiftRequest,
} from "@/lib/domain/shifts";
import {
  createPublicRecruitment,
  updateMaxEntries,
  deleteRecruitment,
  affordableMaxEntries,
  assignStaffToRecruitment,
  openRecruitmentToPublic,
  saveRecruitmentPublicDraft,
} from "@/lib/domain/recruitment";
import type { WageType } from "@/generated/prisma/enums";

export async function createAssignedShiftAction(input: {
  teamId?: string;
  staffUserId: string;
  dates: string[]; // YYYY-MM-DD, one or more
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  isUndecided: boolean;
  note?: string;
  companyRelationshipId?: string;
  // 依頼主が、実体のある連携済み派遣会社の配属済みスタッフに直接シフトを
  // 作る場合のみセットされる。この場合作られるシフトの実体はその派遣会社
  // 側の通常のCLIENT-sourceシフトと同じもの（companyId=派遣会社）になる
  // ため、通常のcompanyRelationshipId（このcompany自身が依頼主にアサイン
  // する向き）とは別パラメータにしている。
  viaAgencyRelationshipId?: string;
  taskName?: string;
  overridesByDate?: Record<string, string[]>; // date -> conflicting shift ids to supersede, set once confirmed
  confirmedOffDates?: string[]; // dates where a pending 休み希望 has already been confirmed by the caller
}) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManageShifts(membership, input.teamId)) throw new Error("forbidden");

  let shiftCompanyId = membership.companyId;
  let effectiveCompanyRelationshipId = input.companyRelationshipId;
  let effectiveTeamId = input.teamId;

  if (input.viaAgencyRelationshipId) {
    // 他社（派遣会社）名義でシフトを作る、会社をまたぐ操作のため、チーム
    // マネージャーではなく会社スコープの管理者/編集者に限定する。
    if (!isCompanyScopeAdmin(membership)) throw new Error("forbidden");
    const rel = await prisma.companyRelationship.findUnique({ where: { id: input.viaAgencyRelationshipId } });
    if (!rel || rel.clientCompanyId !== membership.companyId || !rel.agencyCompanyId || rel.status !== "ACTIVE") {
      throw new Error("forbidden");
    }
    const placement = await prisma.staffPlacement.findFirst({
      where: { staffUserId: input.staffUserId, companyRelationshipId: rel.id, active: true },
    });
    if (!placement) throw new Error("forbidden");
    shiftCompanyId = rel.agencyCompanyId;
    effectiveCompanyRelationshipId = rel.id;
    effectiveTeamId = undefined;
  }

  const offRequestDates: string[] = [];
  const conflictsByDate: { date: string; conflicts: { id: string; startTime: string | null; endTime: string | null }[] }[] = [];
  const createdShiftIds: string[] = [];

  for (const date of input.dates) {
    const result = await createAssignedShift({
      companyId: shiftCompanyId,
      teamId: effectiveTeamId,
      staffUserId: input.staffUserId,
      date: new Date(`${date}T00:00:00.000Z`),
      startTime: input.startTime,
      endTime: input.endTime,
      isAllDay: input.isAllDay,
      isUndecided: input.isUndecided,
      companyRelationshipId: effectiveCompanyRelationshipId,
      taskName: input.taskName,
      note: input.note,
      confirmedByUserId: userId,
      overrideShiftIds: input.overridesByDate?.[date],
      confirmedDespiteOffRequest: input.confirmedOffDates?.includes(date),
    });
    if (result.status === "off_request") {
      offRequestDates.push(date);
    } else if (result.status === "conflict") {
      conflictsByDate.push({ date, conflicts: result.conflicts });
    } else {
      createdShiftIds.push(result.shift.id);
    }
  }

  if (offRequestDates.length > 0 || conflictsByDate.length > 0) {
    // all-or-nothing across the whole date range: roll back this pass's
    // successes so a retry with confirmedOffDates/overridesByDate doesn't
    // double-create them.
    if (createdShiftIds.length > 0) {
      await prisma.shift.deleteMany({ where: { id: { in: createdShiftIds } } });
    }
    if (offRequestDates.length > 0) {
      return { status: "off_request" as const, offRequestDates };
    }
    return { status: "conflict" as const, conflictsByDate };
  }

  revalidatePath("/company/calendar");
  revalidatePath("/company");
  return { status: "created" as const, count: createdShiftIds.length };
}

// オーダーとして作成する — 無料なのでTee残高のチェックは不要（公開募集への
// 切り替え時にopenRecruitmentToPublicAction側でチェックする）。
export async function createPublicRecruitmentAction(input: {
  teamId?: string;
  title: string;
  jobDescription?: string;
  note?: string;
  dates: string[];
  startTime?: string;
  endTime?: string;
  isUndecided: boolean;
  maxEntries: number;
}) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManageShifts(membership, input.teamId)) throw new Error("forbidden");

  await createPublicRecruitment({
    companyId: membership.companyId,
    teamId: input.teamId,
    title: input.title,
    jobDescription: input.jobDescription,
    note: input.note,
    dates: input.dates.map((d) => new Date(`${d}T00:00:00.000Z`)),
    startTime: input.startTime,
    endTime: input.endTime,
    isUndecided: input.isUndecided,
    maxEntries: input.maxEntries,
    createdByUserId: userId,
  });
  revalidatePath("/company/calendar");
}

export async function openRecruitmentToPublicAction(input: {
  recruitmentId: string;
  remaining: number;
  hourlyWage: number;
  wageType: WageType;
  extraItems: { label: string; value: string }[];
}) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const recruitment = await prisma.publicRecruitment.findUniqueOrThrow({ where: { id: input.recruitmentId } });
  if (!canManageShifts(membership, recruitment.teamId)) throw new Error("forbidden");

  const affordable = await affordableMaxEntries(membership.companyId);
  if (input.remaining > affordable) {
    throw new Error("insufficient_tee_balance");
  }

  await openRecruitmentToPublic({
    recruitmentId: input.recruitmentId,
    hourlyWage: input.hourlyWage,
    wageType: input.wageType,
    extraItems: input.extraItems,
    updatedByUserId: userId,
  });
  revalidatePath("/company/calendar");
}

// 公開募集の内容だけ先に下書き保存する（visibility=ORDERのまま、Teeも動かさ
// ない）。管理者権限のチェックだけ行い、あとは中身をそのまま保存する。
export async function saveRecruitmentPublicDraftAction(input: {
  recruitmentId: string;
  hourlyWage?: number;
  wageType?: WageType;
  extraItems: { label: string; value: string }[];
}) {
  const { membership } = await requireCompanyAdminOrEditor();
  const recruitment = await prisma.publicRecruitment.findUniqueOrThrow({ where: { id: input.recruitmentId } });
  if (!canManageShifts(membership, recruitment.teamId)) throw new Error("forbidden");

  await saveRecruitmentPublicDraft(input);
  revalidatePath("/company/calendar");
}

export async function updateMaxEntriesAction(recruitmentId: string, newMaxEntries: number) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  // オーダー(visibility=ORDER)は無課金なのでTee残高の上限チェックは不要
  // （公開募集化済みのものだけ、上限を上げる分のTeeが払えるか確認する）。
  const recruitment = await prisma.publicRecruitment.findUniqueOrThrow({ where: { id: recruitmentId } });
  if (!canManageShifts(membership, recruitment.teamId)) throw new Error("forbidden");
  if (recruitment.visibility === "PUBLIC") {
    const affordable = await affordableMaxEntries(membership.companyId);
    if (newMaxEntries > affordable) {
      throw new Error("insufficient_tee_balance");
    }
  }

  await updateMaxEntries({ recruitmentId, newMaxEntries, updatedByUserId: userId });
  revalidatePath("/company/calendar");
}

export async function deleteRecruitmentAction(recruitmentId: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const recruitment = await prisma.publicRecruitment.findUniqueOrThrow({ where: { id: recruitmentId } });
  if (!canManageShifts(membership, recruitment.teamId)) throw new Error("forbidden");

  await deleteRecruitment({ recruitmentId, updatedByUserId: userId });
  revalidatePath("/company/calendar");
}

// 起こりうる失敗理由を日本語に変換する — Next.jsは本番ビルドでServer
// Actionから素通しで投げた例外のmessageを握りつぶしてしまうため
// （セキュリティ上の既定動作）、ここで必ず捕まえて{status:"error"}として
// 返す。これをせず投げっぱなしにすると、呼び出し元には理由の分からない
// 空の失敗表示しか届かない（本番でだけ再現していた「追加できませんでした」
// の原因）。
const ASSIGN_ERROR_LABEL: Record<string, string> = {
  recruitment_full: "満員になりました",
  recruitment_not_open: "募集が終了しています",
  recruitment_in_past: "日付が過ぎています",
  staff_not_in_company: "自社のスタッフではありません",
  forbidden: "権限がありません",
};

export async function assignStaffToRecruitmentAction(input: {
  recruitmentId: string;
  staffUserId: string;
  overrideShiftIds?: string[];
  confirmedDespiteOffRequest?: boolean;
}) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const recruitment = await prisma.publicRecruitment.findUniqueOrThrow({ where: { id: input.recruitmentId } });
  if (!canManageShifts(membership, recruitment.teamId)) throw new Error("forbidden");

  try {
    const result = await assignStaffToRecruitment({
      recruitmentId: input.recruitmentId,
      staffUserId: input.staffUserId,
      assignerCompanyId: membership.companyId,
      assignedByUserId: userId,
      overrideShiftIds: input.overrideShiftIds,
      confirmedDespiteOffRequest: input.confirmedDespiteOffRequest,
    });
    if (result.status === "created") {
      revalidatePath("/company/calendar");
      revalidatePath("/company");
    }
    return result;
  } catch (error) {
    // 同じスタッフを重複して追加しようとした場合（一覧が更新される前に
    // 連続でボタンを押した等）はDBのユニーク制約違反になる。
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return { status: "error" as const, reason: "既に追加されています" };
    }
    if (error instanceof Error) {
      return { status: "error" as const, reason: ASSIGN_ERROR_LABEL[error.message] ?? error.message };
    }
    throw error;
  }
}

export async function cancelShiftAction(shiftId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
  if (!canManageShifts(membership, shift.teamId)) throw new Error("forbidden");

  await cancelShift({ shiftId, actorCompanyId: membership.companyId });
  revalidatePath("/company/calendar");
}

export async function dismissShiftRequestAction(requestId: string, date: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  await dismissShiftRequest({
    requestId,
    companyId: membership.companyId,
    date: new Date(`${date}T00:00:00.000Z`),
  });
  revalidatePath("/company/calendar");
}
