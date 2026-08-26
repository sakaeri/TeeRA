import "server-only";
import { prisma } from "@/lib/prisma";
import { postLedgerEntry } from "@/lib/domain/wallet";

function monthRange(periodLabel: string) {
  const [year, month] = periodLabel.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}

async function alreadyInvoicedShiftIds(companyRelationshipId: string, excludeInvoiceId?: string) {
  const issued = await prisma.invoice.findMany({
    where: {
      companyRelationshipId,
      status: "ISSUED",
      id: excludeInvoiceId ? { not: excludeInvoiceId } : undefined,
    },
    select: { invoicedShiftIds: true },
  });
  const ids = new Set<string>();
  for (const inv of issued) {
    for (const id of (inv.invoicedShiftIds as string[]) ?? []) ids.add(id);
  }
  return ids;
}

// フォールバック: シフト作成時に業務内容(単価)が選ばれていない場合のみ使う
// 既定単価。関係に登録された一番古い単価。
async function fallbackRateForRelationship(companyId: string, companyRelationshipId: string) {
  const rate = await prisma.companyPlacementRate.findFirst({
    where: { companyId, companyRelationshipId },
    orderBy: { createdAt: "asc" },
  });
  return rate ? { taskName: rate.taskName, wageType: rate.wageType, amount: rate.amount } : null;
}

// 請求書の対象シフト: this agency's own shifts performed AT that client
// (source=CLIENT), with approved WORKED hours, not already locked into a
// previously ISSUED invoice for the same 依頼主 (invoicedShiftIds only locks
// at actual issuance, never at 確定 — chat29/30 bugfix).
async function regenerateLines(invoiceId: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (invoice.status !== "DRAFT") return invoice;

  const { start, end } = monthRange(invoice.periodLabel);
  const excluded = await alreadyInvoicedShiftIds(invoice.companyRelationshipId, invoice.id);

  const shifts = await prisma.shift.findMany({
    where: {
      companyId: invoice.issuingCompanyId,
      companyRelationshipId: invoice.companyRelationshipId,
      source: "CLIENT",
      date: { gte: start, lt: end },
      status: { notIn: ["SUPERSEDED", "CANCELLED"] },
    },
    include: { staff: true, workReport: true, companyPlacementRate: true },
  });

  const fallbackRate = await fallbackRateForRelationship(invoice.issuingCompanyId, invoice.companyRelationshipId);

  await prisma.$transaction(async (tx) => {
    await tx.invoiceLine.deleteMany({ where: { invoiceId: invoice.id, shiftId: { not: null } } });
    for (const s of shifts) {
      if (excluded.has(s.id)) continue;
      const report = s.workReport;
      if (!report || report.outcome !== "WORKED" || report.approvalStatus !== "APPROVED") continue;
      const workedHours = Math.round((report.computedMinutes / 60) * 100) / 100;
      if (workedHours <= 0) continue;

      // シフト作成時に選んだ業務内容の単価を優先し、選ばれていなければ
      // その依頼主に登録されている一番古い単価にフォールバックする
      // （業務内容が複数ある依頼主でも、日給/時給が混在していても正しく
      // 区別できるようにするための対応）。月給の単価は日々のシフト単位では
      // 自動計上しない。
      const taskRate = s.companyPlacementRate ?? fallbackRate;
      if (!taskRate || taskRate.wageType === "MONTHLY") continue;
      const isHourly = taskRate.wageType === "HOURLY";
      const lineHours = isHourly ? workedHours : 1;
      const rate = taskRate.amount;
      const taskLabel = taskRate.taskName ? `（${taskRate.taskName}）` : "";

      await tx.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          shiftId: s.id,
          staffName: s.staff.name,
          description: `${s.date.toISOString().slice(0, 10)} 勤務${taskLabel}`,
          hours: lineHours,
          rate,
          amount: Math.round(lineHours * rate),
          taxRatePercent: 10,
        },
      });
    }
  });

  return invoice;
}

export async function getOrCreateInvoice(params: {
  issuingCompanyId: string;
  companyRelationshipId: string;
  periodLabel: string;
}) {
  // One invoice row per issuing company × client × period, regardless of
  // status — issuing doesn't create a new row, it flips status on this one
  // (mirrors the SalarySlip unique-per-month model). Editing after issuance
  // goes through reopenInvoiceForEdit, which flips status back to DRAFT on
  // this same row instead of orphaning it behind a fresh one.
  let invoice = await prisma.invoice.findFirst({
    where: {
      issuingCompanyId: params.issuingCompanyId,
      companyRelationshipId: params.companyRelationshipId,
      periodLabel: params.periodLabel,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!invoice) {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: params.issuingCompanyId } });
    invoice = await prisma.invoice.create({
      data: {
        issuingCompanyId: params.issuingCompanyId,
        companyRelationshipId: params.companyRelationshipId,
        periodLabel: params.periodLabel,
        invoiceRegistrationNumberSnapshot: company.invoiceRegistrationNumber,
      },
    });
  }

  await regenerateLines(invoice.id);
  return prisma.invoice.findUniqueOrThrow({
    where: { id: invoice.id },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function addCustomLine(params: {
  invoiceId: string;
  staffName: string;
  description: string;
  hours: number;
  rate: number;
  taxRatePercent: number;
}) {
  return prisma.invoiceLine.create({
    data: {
      invoiceId: params.invoiceId,
      staffName: params.staffName,
      description: params.description,
      hours: params.hours,
      rate: params.rate,
      amount: Math.round(params.hours * params.rate),
      taxRatePercent: params.taxRatePercent,
    },
  });
}

export async function updateLine(
  lineId: string,
  changes: { hours?: number; rate?: number; taxRatePercent?: number },
) {
  const line = await prisma.invoiceLine.findUniqueOrThrow({ where: { id: lineId } });
  const hours = changes.hours ?? line.hours;
  const rate = changes.rate ?? line.rate;
  return prisma.invoiceLine.update({
    where: { id: lineId },
    data: {
      hours,
      rate,
      amount: Math.round(hours * rate),
      taxRatePercent: changes.taxRatePercent ?? line.taxRatePercent,
    },
  });
}

export async function deleteLine(lineId: string) {
  return prisma.invoiceLine.delete({ where: { id: lineId } });
}

export async function setDueDate(invoiceId: string, dueDate: Date) {
  return prisma.invoice.update({ where: { id: invoiceId }, data: { dueDate } });
}

export async function setNote(invoiceId: string, note: string) {
  return prisma.invoice.update({ where: { id: invoiceId }, data: { note } });
}

// インボイス番号はここで編集すると本部設定へ自動的に反映される（双方向同期）。
export async function setInvoiceRegistrationNumber(companyId: string, invoiceId: string, number: string) {
  await prisma.$transaction([
    prisma.company.update({ where: { id: companyId }, data: { invoiceRegistrationNumber: number || null } }),
    prisma.invoice.update({
      where: { id: invoiceId },
      data: { invoiceRegistrationNumberSnapshot: number || null },
    }),
  ]);
}

export function computeInvoiceTotals(params: {
  lines: { amount: number; taxRatePercent: number }[];
  registered: boolean;
}) {
  const brackets = [10, 8].map((rate) => {
    const subtotal = params.lines
      .filter((l) => l.taxRatePercent === rate)
      .reduce((sum, l) => sum + l.amount, 0);
    const tax = params.registered ? Math.floor((subtotal * rate) / 100) : 0;
    return { rate, subtotal, tax };
  });
  const subtotalAll = params.lines.reduce((sum, l) => sum + l.amount, 0);
  const taxAll = brackets.reduce((sum, b) => sum + b.tax, 0);
  return { brackets, subtotalAll, taxAll, total: subtotalAll + taxAll };
}

// 内容を修正する: reopens an ISSUED invoice for editing. The next 発行 will
// charge another 1 Tee (invoice content differs each time, unlike salary
// slips) and record a new revision in the issue history.
export async function reopenInvoiceForEdit(invoiceId: string) {
  return prisma.invoice.update({ where: { id: invoiceId }, data: { status: "DRAFT" } });
}

export async function confirmInvoice(invoiceId: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (!invoice.dueDate) throw new Error("due_date_required");
  return prisma.invoice.update({ where: { id: invoiceId }, data: { status: "CONFIRMED" } });
}

// 発行: every issuance (including corrections) charges 1 Tee — unlike salary
// slips, invoice content is different shift-to-shift so there is no free
// re-issue. invoicedShiftIds is locked here, at actual issuance, not at 確定
// (a real bug in the prototype fixed in chat29/30: confirming without
// issuing was destructively consuming shift data).
export async function issueInvoice(params: { invoiceId: string; issuedByUserId: string }) {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: params.invoiceId },
    include: { lines: true, companyRelationship: true },
  });
  if (!invoice.dueDate) throw new Error("due_date_required");

  const registered = Boolean(invoice.invoiceRegistrationNumberSnapshot);
  const totals = computeInvoiceTotals({ lines: invoice.lines, registered });
  const shiftIds = invoice.lines.map((l) => l.shiftId).filter((id): id is string => Boolean(id));

  return prisma.$transaction(async (tx) => {
    await postLedgerEntry(tx, {
      companyId: invoice.issuingCompanyId,
      type: "CONSUME_INVOICE_ISSUE",
      amount: -1,
      createdByUserId: params.issuedByUserId,
    });

    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "ISSUED", invoicedShiftIds: shiftIds },
    });

    return tx.invoiceIssue.create({
      data: {
        invoiceId: invoice.id,
        snapshot: {
          periodLabel: invoice.periodLabel,
          dueDate: invoice.dueDate?.toISOString(),
          note: invoice.note,
          lines: invoice.lines,
          registered,
          invoiceRegistrationNumber: invoice.invoiceRegistrationNumberSnapshot,
          ...totals,
          issuedAt: new Date().toISOString(),
        },
      },
    });
  });
}

export async function listInvoicesForCompany(companyId: string) {
  return prisma.invoice.findMany({
    where: { issuingCompanyId: companyId },
    include: { companyRelationship: { include: { clientCompany: true } }, lines: true, issues: true },
    orderBy: { createdAt: "desc" },
  });
}
