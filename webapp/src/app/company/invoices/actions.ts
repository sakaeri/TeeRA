"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManage } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import {
  getOrCreateInvoice,
  addCustomLine,
  updateLine,
  deleteLine,
  setDueDate,
  setNote,
  setInvoiceRegistrationNumber,
  confirmInvoice,
  issueInvoice,
  reopenInvoiceForEdit,
} from "@/lib/domain/invoicing";

async function assertAccess(invoiceId: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (invoice.issuingCompanyId !== membership.companyId || !canManage(membership)) {
    throw new Error("forbidden");
  }
  return { userId, membership, invoice };
}

export async function openInvoiceAction(companyRelationshipId: string, periodLabel: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  const invoice = await getOrCreateInvoice({
    issuingCompanyId: membership.companyId,
    companyRelationshipId,
    periodLabel,
  });
  revalidatePath("/company/invoices");
  return invoice.id;
}

export async function addCustomLineAction(
  invoiceId: string,
  input: { staffName: string; description: string; hours: number; rate: number; taxRatePercent: number },
) {
  await assertAccess(invoiceId);
  await addCustomLine({ invoiceId, ...input });
  revalidatePath("/company/invoices");
}

export async function updateLineAction(
  lineId: string,
  changes: { hours?: number; rate?: number; taxRatePercent?: number },
) {
  const line = await prisma.invoiceLine.findUniqueOrThrow({ where: { id: lineId } });
  await assertAccess(line.invoiceId);
  await updateLine(lineId, changes);
  revalidatePath("/company/invoices");
}

export async function deleteLineAction(lineId: string) {
  const line = await prisma.invoiceLine.findUniqueOrThrow({ where: { id: lineId } });
  await assertAccess(line.invoiceId);
  await deleteLine(lineId);
  revalidatePath("/company/invoices");
}

export async function setDueDateAction(invoiceId: string, dueDate: string) {
  await assertAccess(invoiceId);
  await setDueDate(invoiceId, new Date(`${dueDate}T00:00:00.000Z`));
  revalidatePath("/company/invoices");
}

export async function setNoteAction(invoiceId: string, note: string) {
  await assertAccess(invoiceId);
  await setNote(invoiceId, note);
  revalidatePath("/company/invoices");
}

export async function setInvoiceRegistrationNumberAction(invoiceId: string, number: string) {
  const { membership } = await assertAccess(invoiceId);
  await setInvoiceRegistrationNumber(membership.companyId, invoiceId, number);
  revalidatePath("/company/invoices");
  revalidatePath("/company/settings");
}

export async function confirmInvoiceAction(invoiceId: string) {
  await assertAccess(invoiceId);
  await confirmInvoice(invoiceId);
  revalidatePath("/company/invoices");
}

export async function issueInvoiceAction(invoiceId: string) {
  const { userId } = await assertAccess(invoiceId);
  await issueInvoice({ invoiceId, issuedByUserId: userId });
  revalidatePath("/company/invoices");
}

export async function reopenInvoiceForEditAction(invoiceId: string) {
  await assertAccess(invoiceId);
  await reopenInvoiceForEdit(invoiceId);
  revalidatePath("/company/invoices");
}
