"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyStaffRole } from "@/lib/auth/session";
import { submitShiftRequest } from "@/lib/domain/shifts";
import { applyToRecruitment } from "@/lib/domain/recruitment";
import { clockIn, clockOut, submitWorkReport, confirmCorrectedWorkReport } from "@/lib/domain/workReports";
import { markStaffNoticeRead } from "@/lib/domain/notices";
import { updateMembershipIdDocument, updateMembershipBankInfo } from "@/lib/domain/roster";
import { prisma } from "@/lib/prisma";

async function assertOwnShift(shiftId: string, staffUserId: string) {
  const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
  if (shift.staffUserId !== staffUserId) throw new Error("forbidden");
}

// 自分自身のCompanyMembership.id — クライアントから渡させず、必ずサーバー側で
// セッションのuserIdと、渡されたcompanyIdの組み合わせから引き直す（他人の
// membershipIdや他社への書き込みを防ぐ）。所属先設定が複数社対応になった
// ため、対象は「今アクティブな会社」ではなく明示的なcompanyIdで受け取る。
async function myMembershipId(userId: string, companyId: string) {
  const membership = await prisma.companyMembership.findUniqueOrThrow({
    where: { userId_companyId: { userId, companyId } },
  });
  return membership.id;
}

export async function updateMyIdDocumentAction(companyId: string, side: "front" | "back", url: string) {
  const { userId } = await requireCompanyStaffRole();
  const membershipId = await myMembershipId(userId, companyId);
  await updateMembershipIdDocument({ membershipId, side, url });
  revalidatePath(`/staff/contracts/${companyId}`);
}

export async function updateMyBankInfoAction(
  companyId: string,
  input: {
    bankName: string;
    branchName: string;
    accountType: string;
    accountNumber: string;
    accountHolderName: string;
  },
) {
  const { userId } = await requireCompanyStaffRole();
  const membershipId = await myMembershipId(userId, companyId);
  await updateMembershipBankInfo({ membershipId, ...input });
  revalidatePath(`/staff/contracts/${companyId}`);
}

export async function clockInAction(shiftId: string) {
  const { userId } = await requireCompanyStaffRole();
  await assertOwnShift(shiftId, userId);
  await clockIn({ shiftId, staffUserId: userId });
  revalidatePath("/staff/timecard");
  revalidatePath("/staff");
}

export async function clockOutAction(shiftId: string) {
  const { userId } = await requireCompanyStaffRole();
  await assertOwnShift(shiftId, userId);
  await clockOut({ shiftId, staffUserId: userId });
  revalidatePath("/staff/timecard");
  revalidatePath("/staff");
}

export async function submitWorkReportAction(input: {
  shiftId: string;
  outcome: "WORKED" | "ABSENT" | "CANCELLED_BY_EMPLOYER";
  comment?: string;
  taskName?: string;
  breakMinutes?: number;
}) {
  const { userId } = await requireCompanyStaffRole();
  await assertOwnShift(input.shiftId, userId);
  await submitWorkReport({
    shiftId: input.shiftId,
    staffUserId: userId,
    outcome: input.outcome,
    comment: input.comment,
    taskName: input.taskName,
    breakMinutes: input.breakMinutes,
  });
  revalidatePath("/staff/timecard");
  revalidatePath("/staff");
}

export async function confirmCorrectedWorkReportAction(workReportId: string) {
  const { userId } = await requireCompanyStaffRole();
  await confirmCorrectedWorkReport({ workReportId, staffUserId: userId });
  revalidatePath("/staff/timecard");
  revalidatePath("/staff");
}

// カレンダーが所属する全社分をまとめて表示するようになったのに合わせ、
// シフト希望申請も「今アクティブな会社」に固定せず、どの勤務先宛かを
// 明示的に選べるようにした。他人の会社IDを渡されて成りすませないよう、
// 本当にそのuserIdがそのcompanyIdに所属しているかをサーバー側で必ず検証する。
export async function submitShiftRequestAction(input: {
  companyId: string;
  desire: "WORK" | "OFF";
  dates: string[];
  note?: string;
}) {
  const { userId } = await requireCompanyStaffRole();
  const membership = await prisma.companyMembership.findUnique({
    where: { userId_companyId: { userId, companyId: input.companyId } },
  });
  if (!membership) throw new Error("forbidden");

  await submitShiftRequest({
    staffUserId: userId,
    companyId: input.companyId,
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

export async function markStaffNoticeReadAction(noticeId: string) {
  const { userId } = await requireCompanyStaffRole();
  await markStaffNoticeRead(noticeId, userId);
  revalidatePath("/staff");
}
