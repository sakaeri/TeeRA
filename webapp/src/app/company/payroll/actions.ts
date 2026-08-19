"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManage } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import {
  getOrCreateSalarySlip,
  addCustomLine,
  updateLine,
  deleteLine,
  updateDeductions,
  updatePaidLeave,
  finalizeSalarySlip,
  issueSalarySlip,
  type DeductionItem,
} from "@/lib/domain/payroll";

async function assertAccess(salarySlipId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  const slip = await prisma.salarySlip.findUniqueOrThrow({ where: { id: salarySlipId } });
  if (slip.companyId !== membership.companyId || !canManage(membership)) {
    throw new Error("forbidden");
  }
  return { membership, slip };
}

export async function openSalarySlipAction(staffUserId: string, targetMonth: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

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
