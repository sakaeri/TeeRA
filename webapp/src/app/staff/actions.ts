"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyStaffRole } from "@/lib/auth/session";
import { submitShiftRequest } from "@/lib/domain/shifts";
import { applyToRecruitment } from "@/lib/domain/recruitment";
import { clockIn, clockOut, submitWorkReport } from "@/lib/domain/workReports";
import { prisma } from "@/lib/prisma";

async function assertOwnShift(shiftId: string, staffUserId: string) {
  const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
  if (shift.staffUserId !== staffUserId) throw new Error("forbidden");
}

export async function clockInAction(shiftId: string) {
  const { userId } = await requireCompanyStaffRole();
  await assertOwnShift(shiftId, userId);
  await clockIn({ shiftId, staffUserId: userId });
  revalidatePath("/staff/timecard");
}

export async function clockOutAction(shiftId: string, breakMinutes?: number) {
  const { userId } = await requireCompanyStaffRole();
  await assertOwnShift(shiftId, userId);
  await clockOut({ shiftId, staffUserId: userId, breakMinutes });
  revalidatePath("/staff/timecard");
}

export async function submitWorkReportAction(input: {
  shiftId: string;
  outcome: "WORKED" | "ABSENT" | "CANCELLED_BY_EMPLOYER";
  comment?: string;
}) {
  const { userId } = await requireCompanyStaffRole();
  await assertOwnShift(input.shiftId, userId);
  await submitWorkReport({
    shiftId: input.shiftId,
    staffUserId: userId,
    outcome: input.outcome,
    comment: input.comment,
  });
  revalidatePath("/staff/timecard");
}

export async function submitShiftRequestAction(input: {
  desire: "WORK" | "OFF";
  dates: string[];
  note?: string;
}) {
  const { userId, membership } = await requireCompanyStaffRole();

  await submitShiftRequest({
    staffUserId: userId,
    companyId: membership.companyId,
    desire: input.desire,
    dates: input.dates.map((d) => new Date(`${d}T00:00:00.000Z`)),
    note: input.note,
  });
  revalidatePath("/staff");
}

export async function applyToRecruitmentAction(recruitmentId: string) {
  const { userId } = await requireCompanyStaffRole();

  try {
    await applyToRecruitment({ recruitmentId, staffUserId: userId });
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath("/staff/recruitments");
  revalidatePath("/staff");
  return { error: null };
}
