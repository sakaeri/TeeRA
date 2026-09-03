"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManageAny } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { getStaffTeamIds } from "@/lib/domain/teams";
import {
  getOrCreateSalarySlip,
  addCustomLine,
  updateLine,
  deleteLine,
  updateDeductions,
  updatePaidLeave,
  finalizeSalarySlip,
  issueSalarySlip,
  renameUnresolvedTaskNames,
  type DeductionItem,
} from "@/lib/domain/payroll";

async function assertAccess(salarySlipId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  const slip = await prisma.salarySlip.findUniqueOrThrow({ where: { id: salarySlipId } });
  const staffTeamIds = await getStaffTeamIds(slip.staffUserId);
  if (slip.companyId !== membership.companyId || !canManageAny(membership, staffTeamIds)) {
    throw new Error("forbidden");
  }
  return { membership, slip };
}

export async function openSalarySlipAction(staffUserId: string, targetMonth: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  const staffTeamIds = await getStaffTeamIds(staffUserId);
  if (!canManageAny(membership, staffTeamIds)) throw new Error("forbidden");

  const slip = await getOrCreateSalarySlip({
    companyId: membership.companyId,
    staffUserId,
    targetMonth,
  });
  revalidatePath("/company/payroll");
  return slip.id;
}

export async function addCustomLineAction(salarySlipId: string, description: string, hours: number, rate: number) {
  await assertAccess(salarySlipId);
  await addCustomLine({ salarySlipId, description, hours, rate });
  revalidatePath("/company/payroll");
}

export async function updateLineAction(lineId: string, hours: number, rate: number) {
  const line = await prisma.salarySlipLine.findUniqueOrThrow({ where: { id: lineId } });
  await assertAccess(line.salarySlipId);
  await updateLine(lineId, { hours, rate });
  revalidatePath("/company/payroll");
}

export async function deleteLineAction(lineId: string) {
  const line = await prisma.salarySlipLine.findUniqueOrThrow({ where: { id: lineId } });
  await assertAccess(line.salarySlipId);
  await deleteLine(lineId);
  revalidatePath("/company/payroll");
}

export async function updateDeductionsAction(salarySlipId: string, deductions: DeductionItem[]) {
  await assertAccess(salarySlipId);
  await updateDeductions(salarySlipId, deductions);
  revalidatePath("/company/payroll");
}

export async function updatePaidLeaveAction(
  salarySlipId: string,
  changes: { paidLeaveDaysUsed?: number; paidLeaveDailyRate?: number; paidLeaveGrantDays?: number },
) {
  await assertAccess(salarySlipId);
  await updatePaidLeave(salarySlipId, changes);
  revalidatePath("/company/payroll");
}

export async function finalizeSalarySlipAction(salarySlipId: string) {
  await assertAccess(salarySlipId);
  await finalizeSalarySlip(salarySlipId);
  revalidatePath("/company/payroll");
}

export async function issueSalarySlipAction(salarySlipId: string) {
  const { userId } = await requireCompanyAdminOrEditor();
  await assertAccess(salarySlipId);
  await issueSalarySlip({ salarySlipId, issuedByUserId: userId });
  revalidatePath("/company/payroll");
}

// 給与計算画面の「単価未設定」警告に出ている表記ゆれを、まとめて選んで
// 正しい業務内容名に直す（直した結果、次回の再計算で単価が解決すれば
// 警告は消える）。
export async function renameUnresolvedTaskNamesAction(
  salarySlipId: string,
  items: { shiftId: string; workReportId: string; source: "workReport" | "shift" }[],
  newTaskName: string,
) {
  const { slip } = await assertAccess(salarySlipId);
  if (!newTaskName.trim()) throw new Error("invalid_task_name");
  await renameUnresolvedTaskNames({
    companyId: slip.companyId,
    staffUserId: slip.staffUserId,
    items,
    newTaskName: newTaskName.trim(),
  });
  revalidatePath("/company/payroll");
}
