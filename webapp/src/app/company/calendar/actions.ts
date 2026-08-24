"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManage } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import {
  createAssignedShift,
  matchShiftRequestToShift,
  dismissShiftRequest,
  cancelShift,
} from "@/lib/domain/shifts";
import {
  createPublicRecruitment,
  updateMaxEntries,
  stopOrDeleteRecruitment,
  affordableMaxEntries,
  assignStaffToRecruitment,
  openRecruitmentToPublic,
} from "@/lib/domain/recruitment";
import type { WageType } from "@/generated/prisma/enums";

export async function createAssignedShiftAction(input: {
  teamId?: string;
  staffUserId: string;
  date: string; // YYYY-MM-DD
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  isUndecided: boolean;
  note?: string;
  overrideShiftIds?: string[];
  companyRelationshipId?: string;
}) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership, input.teamId)) throw new Error("forbidden");

  const result = await createAssignedShift({
    companyId: membership.companyId,
    teamId: input.teamId,
    staffUserId: input.staffUserId,
    date: new Date(`${input.date}T00:00:00.000Z`),
    startTime: input.startTime,
    endTime: input.endTime,
    isAllDay: input.isAllDay,
    isUndecided: input.isUndecided,
    companyRelationshipId: input.companyRelationshipId,
    note: input.note,
    confirmedByUserId: userId,
    overrideShiftIds: input.overrideShiftIds,
  });

  if (result.status === "created") {
    revalidatePath("/company/calendar");
  }
  return result;
}

export async function matchShiftRequestAction(input: {
  shiftRequestId: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  isUndecided: boolean;
  teamId?: string;
  note?: string;
}) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership, input.teamId)) throw new Error("forbidden");

  await matchShiftRequestToShift({
    shiftRequestId: input.shiftRequestId,
    date: new Date(`${input.date}T00:00:00.000Z`),
    startTime: input.startTime,
    endTime: input.endTime,
    isAllDay: input.isAllDay,
    isUndecided: input.isUndecided,
    teamId: input.teamId,
    note: input.note,
  });
  revalidatePath("/company/calendar");
}

export async function dismissShiftRequestAction(shiftRequestId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  await dismissShiftRequest(shiftRequestId);
  revalidatePath("/company/calendar");
}

// オーダーとして作成する — 無料なのでTee残高のチェックは不要（公開募集への
// 切り替え時にopenRecruitmentToPublicAction側でチェックする）。
export async function createPublicRecruitmentAction(input: {
  teamId?: string;
  title: string;
  jobDescription?: string;
  date: string;
  startTime?: string;
  endTime?: string;
  maxEntries: number;
  publish: boolean;
}) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership, input.teamId)) throw new Error("forbidden");

  await createPublicRecruitment({
    companyId: membership.companyId,
    teamId: input.teamId,
    title: input.title,
    jobDescription: input.jobDescription,
    date: new Date(`${input.date}T00:00:00.000Z`),
    startTime: input.startTime,
    endTime: input.endTime,
    maxEntries: input.maxEntries,
    createdByUserId: userId,
    publish: input.publish,
  });
  revalidatePath("/company/calendar");
}

export async function openRecruitmentToPublicAction(input: {
  recruitmentId: string;
  remaining: number;
  hourlyWage: number;
  wageType: WageType;
  applicationConditions?: string;
  belongings?: string;
  meetingPlace?: string;
}) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  const affordable = await affordableMaxEntries(membership.companyId);
  if (input.remaining > affordable) {
    throw new Error("insufficient_tee_balance");
  }

  await openRecruitmentToPublic({
    recruitmentId: input.recruitmentId,
    hourlyWage: input.hourlyWage,
    wageType: input.wageType,
    applicationConditions: input.applicationConditions,
    belongings: input.belongings,
    meetingPlace: input.meetingPlace,
    updatedByUserId: userId,
  });
  revalidatePath("/company/calendar");
}

export async function updateMaxEntriesAction(recruitmentId: string, newMaxEntries: number) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  // オーダー(visibility=ORDER)は無課金なのでTee残高の上限チェックは不要
  // （公開募集化済みのものだけ、上限を上げる分のTeeが払えるか確認する）。
  const recruitment = await prisma.publicRecruitment.findUniqueOrThrow({ where: { id: recruitmentId } });
  if (recruitment.visibility === "PUBLIC") {
    const affordable = await affordableMaxEntries(membership.companyId);
    if (newMaxEntries > affordable) {
      throw new Error("insufficient_tee_balance");
    }
  }

  await updateMaxEntries({ recruitmentId, newMaxEntries, updatedByUserId: userId });
  revalidatePath("/company/calendar");
}

export async function stopRecruitmentAction(recruitmentId: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  await stopOrDeleteRecruitment({ recruitmentId, updatedByUserId: userId, delete: false });
  revalidatePath("/company/calendar");
}

export async function deleteRecruitmentAction(recruitmentId: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  await stopOrDeleteRecruitment({ recruitmentId, updatedByUserId: userId, delete: true });
  revalidatePath("/company/calendar");
}

export async function assignStaffToRecruitmentAction(input: {
  recruitmentId: string;
  staffUserId: string;
  overrideShiftIds?: string[];
}) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  const result = await assignStaffToRecruitment({
    recruitmentId: input.recruitmentId,
    staffUserId: input.staffUserId,
    assignerCompanyId: membership.companyId,
    assignedByUserId: userId,
    overrideShiftIds: input.overrideShiftIds,
  });
  if (result.status === "created") {
    revalidatePath("/company/calendar");
  }
  return result;
}

export async function cancelShiftAction(shiftId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  await cancelShift({ shiftId, actorCompanyId: membership.companyId });
  revalidatePath("/company/calendar");
}
