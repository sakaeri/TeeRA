"use server";

import { notifyStaffPayslipIssued, notifyStaffInvoiceReviewed } from "@/lib/domain/emailNotifications";
import { openStaffInvoice, reviewStaffInvoice, updateContractorSettings, StaffInvoiceError } from "@/lib/domain/staffInvoices";
import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManageAny } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { getStaffTeamIds } from "@/lib/domain/teams";
import {
  addCustomLine,
  updateLine,
  deleteLine,
  updateDeductions,
  updatePaidLeave,
  setSalarySlipPaymentDay,
  setSalarySlipNote,
  issueSalarySlip,
  reopenSalarySlip,
  renameUnresolvedTaskNames,
  type DeductionItem,
  setSalarySlipGroupShiftLines,
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

export async function setSalarySlipPaymentDayAction(salarySlipId: string, paymentDay: string) {
  await assertAccess(salarySlipId);
  await setSalarySlipPaymentDay(salarySlipId, paymentDay);
  revalidatePath("/company/payroll");
}

export async function setSalarySlipGroupShiftLinesAction(salarySlipId: string, groupShiftLines: boolean) {
  await assertAccess(salarySlipId);
  await setSalarySlipGroupShiftLines(salarySlipId, groupShiftLines === true);
  revalidatePath("/company/payroll");
}

export async function setSalarySlipNoteAction(salarySlipId: string, note: string) {
  await assertAccess(salarySlipId);
  await setSalarySlipNote(salarySlipId, note);
  revalidatePath("/company/payroll");
}

export async function updatePaidLeaveAction(
  salarySlipId: string,
  changes: { paidLeaveDaysUsed?: number; paidLeaveDailyRate?: number },
) {
  const { userId } = await requireCompanyAdminOrEditor();
  await assertAccess(salarySlipId);
  await updatePaidLeave(salarySlipId, changes, userId);
  revalidatePath("/company/payroll");
}

export async function issueSalarySlipAction(salarySlipId: string) {
  const { userId } = await requireCompanyAdminOrEditor();
  await assertAccess(salarySlipId);
  const issue = await issueSalarySlip({ salarySlipId, issuedByUserId: userId });
  // スタッフのアプリの「給料明細」に届いたことを知らせる（送れなくても発行は成立させる）
  await notifyStaffPayslipIssued(issue.salarySlipId).catch((err) => console.error("[notify] payslip issued failed", err));
  revalidatePath("/company/payroll");
}

// 内容を修正する: 確定済み・発行済みの明細を下書きに戻す。再発行は
// 同月内なら引き続き無料（issueSalarySlipのalreadyIssuedThisMonth判定は
// 過去の発行履歴で見ているため、reopenでは変わらない）。
export async function reopenSalarySlipAction(salarySlipId: string) {
  await assertAccess(salarySlipId);
  await reopenSalarySlip(salarySlipId);
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

// ---- 業務委託のスタッフから届いた請求書 ----

async function assertStaffInvoiceAccess(invoiceId: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const invoice = await prisma.staffInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const staffTeamIds = await getStaffTeamIds(invoice.staffUserId);
  if (invoice.companyId !== membership.companyId || !canManageAny(membership, staffTeamIds)) throw new Error("forbidden");
  return { userId, membership, invoice };
}

// 開く（最初の1回だけ、プランの無料枠か1Teeを使う）
export async function openStaffInvoiceAction(invoiceId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { userId, membership } = await assertStaffInvoiceAccess(invoiceId);
  try {
    await openStaffInvoice({ invoiceId, companyId: membership.companyId, userId });
  } catch (e) {
    if (e instanceof Error && e.message === "insufficient_tee_balance") {
      return { ok: false, message: "Teeが足りません。チャージしてから開いてください。" };
    }
    throw e;
  }
  revalidatePath("/company/payroll");
  return { ok: true };
}

export async function reviewStaffInvoiceAction(
  invoiceId: string,
  decision: "approve" | "return",
  reason?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { userId, membership } = await assertStaffInvoiceAccess(invoiceId);
  try {
    await reviewStaffInvoice({ invoiceId, companyId: membership.companyId, userId, decision, reason });
  } catch (e) {
    if (e instanceof StaffInvoiceError) return { ok: false, message: e.message };
    throw e;
  }
  await notifyStaffInvoiceReviewed(invoiceId).catch((err) => console.error("[notify] staff invoice reviewed failed", err));
  revalidatePath("/company/payroll");
  return { ok: true };
}

// スタッフごとの扱い（源泉徴収・消費税）を変える
export async function updateContractorSettingsAction(invoiceId: string, withholding: boolean, taxExclusive: boolean) {
  const { membership, invoice } = await assertStaffInvoiceAccess(invoiceId);
  await updateContractorSettings({
    companyId: membership.companyId,
    staffUserId: invoice.staffUserId,
    withholding: withholding === true,
    taxExclusive: taxExclusive === true,
  });
  revalidatePath("/company/payroll");
}
