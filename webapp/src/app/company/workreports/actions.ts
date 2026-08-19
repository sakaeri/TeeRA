"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManage } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { approveWorkReport, rejectWorkReport, resolveApproverCompanyId } from "@/lib/domain/workReports";

async function assertCanApprove(workReportId: string, companyId: string, teamId: string | null) {
  const report = await prisma.workReport.findUniqueOrThrow({
    where: { id: workReportId },
    include: { shift: true },
  });
  const approverCompanyId = await resolveApproverCompanyId(report.shiftId);
  if (approverCompanyId !== companyId) throw new Error("forbidden");
  return report;
}

export async function approveWorkReportAction(workReportId: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const report = await assertCanApprove(workReportId, membership.companyId, null);
  if (!canManage(membership, report.shift.teamId)) throw new Error("forbidden");

  await approveWorkReport({ workReportId, approverUserId: userId });
  revalidatePath("/company/workreports");
}

export async function rejectWorkReportAction(workReportId: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const report = await assertCanApprove(workReportId, membership.companyId, null);
  if (!canManage(membership, report.shift.teamId)) throw new Error("forbidden");

  await rejectWorkReport({ workReportId, approverUserId: userId });
  revalidatePath("/company/workreports");
}
