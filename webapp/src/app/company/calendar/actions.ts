"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManageShifts, isCompanyScopeAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import {
  createAssignedShift,
  cancelShift,
  dismissShiftRequest,
  updateShiftTime,
  isClientSiteShiftOf,
} from "@/lib/domain/shifts";
import {
  createPublicRecruitment,
  updateMaxEntries,
  deleteRecruitment,
  affordableMaxEntries,
  assignStaffToRecruitment,
  openRecruitmentToPublic,
  saveRecruitmentPublicDraft,
  addRecruitmentAnnouncement,
} from "@/lib/domain/recruitment";
import { listRecruitmentCancelImpacts, previewShiftCancellation } from "@/lib/domain/cancellation";
import {
  notifyAgencyOfClientCancellation,
  notifyStaffShiftReleased,
  notifyStaffShiftTimeChanged,
  notifyAgencyOfClientTimeChange,
  notifyRecruitmentAnnouncement,
} from "@/lib/domain/emailNotifications";
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
  // 募集IDだけで他社の募集を操作できないよう、自社の募集であることを必ず確認する。
  if (recruitment.companyId !== membership.companyId) throw new Error("forbidden");
  if (!canManageShifts(membership, recruitment.teamId)) throw new Error("forbidden");

  try {
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
  } catch (error) {
    // Next.jsは本番ビルドでServer Actionから素通しで投げた例外のmessageを
    // 握りつぶしてしまう（assignStaffToRecruitmentActionのASSIGN_ERROR_LABEL
    // 参照のコメントと同じ理由）ため、ここで必ず捕まえて返す。Tee残高不足の
    // 事前チェックは通っていても、ほぼ同時に他の操作でTeeを使い切った場合は
    // postLedgerEntry側でも同じメッセージで弾かれる。
    return { error: error instanceof Error ? error.message : "unknown" };
  }
  revalidatePath("/company/calendar");
  return { error: null };
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
  if (recruitment.companyId !== membership.companyId) throw new Error("forbidden");
  if (!canManageShifts(membership, recruitment.teamId)) throw new Error("forbidden");

  await saveRecruitmentPublicDraft(input);
  revalidatePath("/company/calendar");
}

export async function updateMaxEntriesAction(recruitmentId: string, newMaxEntries: number) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  // オーダー(visibility=ORDER)は無課金なのでTee残高の上限チェックは不要
  // （公開募集化済みのものだけ、上限を上げる分のTeeが払えるか確認する）。
  const recruitment = await prisma.publicRecruitment.findUniqueOrThrow({ where: { id: recruitmentId } });
  if (recruitment.companyId !== membership.companyId) throw new Error("forbidden");
  if (!canManageShifts(membership, recruitment.teamId)) throw new Error("forbidden");

  try {
    if (recruitment.visibility === "PUBLIC") {
      const affordable = await affordableMaxEntries(membership.companyId);
      if (newMaxEntries > affordable) {
        throw new Error("insufficient_tee_balance");
      }
    }

    await updateMaxEntries({ recruitmentId, newMaxEntries, updatedByUserId: userId });
  } catch (error) {
    // openRecruitmentToPublicActionと同じ理由（Next.jsが本番ビルドで素通しの
    // 例外messageを握りつぶすため）で、必ず捕まえて返す。
    return { error: error instanceof Error ? error.message : "unknown" };
  }
  revalidatePath("/company/calendar");
  return { error: null };
}

// 削除（取り消し）する前に、派遣元のスタッフ分がキャンセル規定でどう扱われる
// かを見せるための確認用。取り消せない分・キャンセル料がかかる分を返す。
export async function previewRecruitmentCancellationAction(recruitmentId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  const recruitment = await prisma.publicRecruitment.findUniqueOrThrow({ where: { id: recruitmentId } });
  if (recruitment.companyId !== membership.companyId) throw new Error("forbidden");
  if (!canManageShifts(membership, recruitment.teamId)) throw new Error("forbidden");

  const impacts = await listRecruitmentCancelImpacts(prisma, recruitmentId);
  return impacts.map((i) => ({
    staffName: i.staffName,
    agencyName: i.agencyName,
    kind: i.evaluation.kind,
    feeAmount: i.evaluation.kind === "fee" ? i.evaluation.amount : 0,
  }));
}

const DELETE_RECRUITMENT_ERROR_LABEL: Record<string, string> = {
  cancel_not_allowed: "派遣会社とのキャンセル規定により、取り消せないスタッフが含まれています。",
  cancel_fee_not_accepted: "キャンセル料がかかります。内容を確認してから取り消してください。",
  recruitment_in_past: "日付が過ぎた募集は削除できません。",
  forbidden: "権限がありません。",
};

export async function deleteRecruitmentAction(recruitmentId: string, acceptFees = false) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const recruitment = await prisma.publicRecruitment.findUniqueOrThrow({ where: { id: recruitmentId } });
  if (recruitment.companyId !== membership.companyId) throw new Error("forbidden");
  if (!canManageShifts(membership, recruitment.teamId)) throw new Error("forbidden");

  try {
    const result = await deleteRecruitment({ recruitmentId, updatedByUserId: userId, acceptFees });
    if (result.cancelledAgencyShifts.length > 0) {
      const company = await prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } });
      await notifyAgencyOfClientCancellation({ clientName: company.name, impacts: result.cancelledAgencyShifts }).catch(
        (err) => console.error("[notify] client cancellation failed", err),
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      return { status: "error" as const, reason: DELETE_RECRUITMENT_ERROR_LABEL[error.message] ?? "削除できませんでした。" };
    }
    throw error;
  }
  revalidatePath("/company/calendar");
  return { status: "ok" as const };
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

// 解除の確認画面用。依頼主の現場のシフトなら、キャンセル規定から計算した
// キャンセル料の目安と、取り消し時のスタッフの扱いの既定値を返す。
export async function previewShiftCancellationAction(shiftId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  const preview = await previewShiftCancellation(shiftId);
  if (preview.shift.companyId !== membership.companyId) throw new Error("forbidden");
  if (!canManageShifts(membership, preview.shift.teamId)) throw new Error("forbidden");
  return {
    status: preview.shift.status,
    isClientShift: preview.isClientShift,
    clientName: preview.clientName,
    ruleLabel: preview.ruleLabel,
    evaluationKind: preview.evaluation.kind,
    suggestedFee: preview.evaluation.kind === "fee" ? preview.evaluation.amount : 0,
    defaultStaffHandling: preview.defaultStaffHandling,
  };
}

const CANCEL_SHIFT_ERROR_LABEL: Record<string, string> = {
  forbidden: "権限がありません。",
  shift_not_active: "このシフトは既に解除されています。",
  shift_in_past: "日付が過ぎたシフトは解除できません。",
  not_client_shift: "依頼主の現場のシフトではありません。",
};

// reason: "CLIENT"＝依頼主都合（電話等で受けた取り消し。キャンセル料を記録し、
// 請求書に載せる）、"OWN"＝自社都合。調整中のシフトを休みにする時は不要。
export async function cancelShiftAction(
  shiftId: string,
  options: { reason?: "CLIENT" | "OWN"; feeAmount?: number; hold?: boolean; notifyStaff?: boolean } = {},
) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const shift = await prisma.shift.findUniqueOrThrow({
    where: { id: shiftId },
    include: { companyRelationship: { include: { clientCompany: true } } },
  });
  if (!canManageShifts(membership, shift.teamId)) throw new Error("forbidden");

  try {
    const updated = await cancelShift({
      shiftId,
      actorCompanyId: membership.companyId,
      actorUserId: userId,
      clientCancellationFee: options.reason === "CLIENT" ? (options.feeAmount ?? 0) : undefined,
      holdForReassignment: options.hold ?? false,
    });
    if (updated.status === "CANCELLED" && options.notifyStaff) {
      await notifyStaffShiftReleased({
        staffUserId: shift.staffUserId,
        date: shift.date,
        workplaceName: shift.companyRelationship?.clientCompany?.name ?? shift.companyRelationship?.proxyName ?? null,
      }).catch((err) => console.error("[notify] shift released failed", err));
    }
  } catch (error) {
    if (error instanceof Error) {
      return { status: "error" as const, reason: CANCEL_SHIFT_ERROR_LABEL[error.message] ?? "解除できませんでした。" };
    }
    throw error;
  }
  revalidatePath("/company/calendar");
  revalidatePath("/company");
  return { status: "ok" as const };
}

const UPDATE_SHIFT_TIME_ERROR_LABEL: Record<string, string> = {
  forbidden: "権限がありません。",
  invalid_time: "開始時刻と終了時刻を入力してください。",
  shift_not_active: "このシフトは解除されているため変更できません。",
  shift_in_past: "日付が過ぎたシフトは変更できません。",
  report_submitted: "業務報告が提出済みのため変更できません（業務報告の内容を修正してください）。",
};

// シフトの出勤時間を入力・変更し、スタッフ本人に知らせる（毎回）。
export async function updateShiftTimeAction(input: {
  shiftId: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  isUndecided: boolean;
  confirmedDespiteConflict?: boolean;
}) {
  const { membership } = await requireCompanyAdminOrEditor();
  const shift = await prisma.shift.findUniqueOrThrow({ where: { id: input.shiftId }, include: { companyRelationship: true } });
  // 派遣会社が自社の現場に入れたシフトは、チームと関係がないので会社全体の管理者だけ
  const allowed =
    shift.companyId === membership.companyId
      ? canManageShifts(membership, shift.teamId)
      : isClientSiteShiftOf(shift, membership.companyId) && isCompanyScopeAdmin(membership);
  if (!allowed) {
    return { status: "error" as const, reason: UPDATE_SHIFT_TIME_ERROR_LABEL.forbidden };
  }

  let result: Awaited<ReturnType<typeof updateShiftTime>>;
  try {
    result = await updateShiftTime({
      shiftId: input.shiftId,
      actorCompanyId: membership.companyId,
      startTime: input.startTime,
      endTime: input.endTime,
      isAllDay: input.isAllDay,
      isUndecided: input.isUndecided,
      confirmedDespiteConflict: input.confirmedDespiteConflict,
    });
  } catch (error) {
    if (error instanceof Error && UPDATE_SHIFT_TIME_ERROR_LABEL[error.message]) {
      return { status: "error" as const, reason: UPDATE_SHIFT_TIME_ERROR_LABEL[error.message] };
    }
    throw error;
  }

  if (result.status === "conflict") {
    return {
      status: "conflict" as const,
      conflicts: result.conflicts.map((c) => ({
        id: c.id,
        label: c.isAllDay ? "終日" : c.isUndecided ? "時間未定" : `${c.startTime}〜${c.endTime}`,
      })),
    };
  }
  if (result.status === "updated") {
    await notifyStaffShiftTimeChanged({ shiftId: result.shift.id, previous: result.previous }).catch((err) =>
      console.error("[notify] shift time changed failed", err),
    );
    if (result.editedByClient) {
      await notifyAgencyOfClientTimeChange({ shiftId: result.shift.id, previous: result.previous }).catch((err) =>
        console.error("[notify] agency time change failed", err),
      );
    }
  }
  revalidatePath("/company/calendar");
  revalidatePath("/company");
  return { status: result.status };
}

const ANNOUNCEMENT_ERROR_LABEL: Record<string, string> = {
  forbidden: "権限がありません。",
  empty_body: "お知らせの内容を入力してください。",
  too_long: "お知らせは1000文字以内で入力してください。",
};

// 募集に「追加のお知らせ」を書き足す。notify=trueの時だけ、エントリー済みの
// スタッフにプッシュ通知（受け取れない人にはメール）も送る。
export async function addRecruitmentAnnouncementAction(input: { recruitmentId: string; body: string; notify: boolean }) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const recruitment = await prisma.publicRecruitment.findUniqueOrThrow({ where: { id: input.recruitmentId } });
  if (recruitment.companyId !== membership.companyId || !canManageShifts(membership, recruitment.teamId)) {
    return { status: "error" as const, reason: ANNOUNCEMENT_ERROR_LABEL.forbidden };
  }
  let result: Awaited<ReturnType<typeof addRecruitmentAnnouncement>>;
  try {
    result = await addRecruitmentAnnouncement({
      recruitmentId: input.recruitmentId,
      actorCompanyId: membership.companyId,
      actorUserId: userId,
      body: input.body,
      notify: input.notify,
    });
  } catch (error) {
    if (error instanceof Error && ANNOUNCEMENT_ERROR_LABEL[error.message]) {
      return { status: "error" as const, reason: ANNOUNCEMENT_ERROR_LABEL[error.message] };
    }
    throw error;
  }
  if (input.notify) {
    await notifyRecruitmentAnnouncement({
      recipientIds: result.recipientIds,
      heading: result.heading,
      body: result.announcement.body,
    }).catch((err) => console.error("[notify] recruitment announcement failed", err));
  }
  revalidatePath("/company/calendar");
  return { status: "ok" as const, recipientCount: result.recipientIds.length };
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
