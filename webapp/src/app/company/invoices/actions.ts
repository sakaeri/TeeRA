"use server";

import { isQuantityUnit } from "@/lib/quantityUnit";
import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManageAny } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { getClientTeamIds } from "@/lib/domain/teams";
import {
  addCustomLine,
  updateLine,
  deleteLine,
  setDueDate,
  setNote,
  setPdfLayout,
  setBankInfo,
  addBankAccount,
  deleteBankAccount,
  selectInvoiceBankAccount,
  type BankAccountInput,
  setInvoiceRegistrationNumber,
  issueInvoice,
  reopenInvoiceForEdit,
} from "@/lib/domain/invoicing";

async function assertAccess(invoiceId: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const clientTeamIds = await getClientTeamIds(invoice.companyRelationshipId);
  if (invoice.issuingCompanyId !== membership.companyId || !canManageAny(membership, clientTeamIds)) {
    throw new Error("forbidden");
  }
  return { userId, membership, invoice };
}

export async function addCustomLineAction(
  invoiceId: string,
  input: { staffName: string; description: string; hours: number; unit?: string | null; rate: number; taxRatePercent: number },
) {
  await assertAccess(invoiceId);
  await addCustomLine({ invoiceId, ...input, unit: isQuantityUnit(input.unit) ? input.unit : null });
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

export async function setPdfLayoutAction(invoiceId: string, layout: { groupLinesByTask?: boolean; attachWorkRecord?: boolean }) {
  await assertAccess(invoiceId);
  await setPdfLayout(invoiceId, {
    groupLinesByTask: typeof layout.groupLinesByTask === "boolean" ? layout.groupLinesByTask : undefined,
    attachWorkRecord: typeof layout.attachWorkRecord === "boolean" ? layout.attachWorkRecord : undefined,
  });
  revalidatePath("/company/invoices");
}

export async function setBankInfoAction(
  invoiceId: string,
  bankInfo: { bankName: string; branchName: string; accountType: string; accountNumber: string; accountHolderName: string },
) {
  await assertAccess(invoiceId);
  await setBankInfo(invoiceId, bankInfo);
  revalidatePath("/company/invoices");
}

function toInput(a: { bankName: string; branchName: string | null; accountType: string | null; accountNumber: string; accountHolderName: string }): BankAccountInput {
  return { ...a, branchName: a.branchName ?? "", accountType: a.accountType ?? "" };
}

// 請求書の振込先を選ぶ（accountId=nullなら「振込先を載せない」）
export async function selectInvoiceBankAccountAction(invoiceId: string, accountId: string | null) {
  const { membership, invoice } = await assertAccess(invoiceId);
  if (invoice.status !== "DRAFT") throw new Error("not_editable");
  const account = accountId
    ? await prisma.companyBankAccount.findFirstOrThrow({ where: { id: accountId, companyId: membership.companyId } })
    : null;
  await selectInvoiceBankAccount(invoiceId, account ? toInput(account) : null);
  revalidatePath("/company/invoices");
}

// 振込先を登録して、そのままこの請求書の振込先にする
export async function addBankAccountAction(invoiceId: string, input: BankAccountInput) {
  const { membership, invoice } = await assertAccess(invoiceId);
  if (invoice.status !== "DRAFT") throw new Error("not_editable");
  const account = await addBankAccount(membership.companyId, {
    bankName: String(input.bankName ?? ""),
    branchName: String(input.branchName ?? ""),
    accountType: String(input.accountType ?? ""),
    accountNumber: String(input.accountNumber ?? ""),
    accountHolderName: String(input.accountHolderName ?? ""),
  });
  await selectInvoiceBankAccount(invoiceId, toInput(account));
  revalidatePath("/company/invoices");
}

export async function deleteBankAccountAction(invoiceId: string, accountId: string) {
  const { membership } = await assertAccess(invoiceId);
  await deleteBankAccount(membership.companyId, accountId);
  revalidatePath("/company/invoices");
}

export async function setInvoiceRegistrationNumberAction(invoiceId: string, number: string) {
  const { membership } = await assertAccess(invoiceId);
  await setInvoiceRegistrationNumber(membership.companyId, invoiceId, number);
  revalidatePath("/company/invoices");
  revalidatePath("/company/settings");
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
