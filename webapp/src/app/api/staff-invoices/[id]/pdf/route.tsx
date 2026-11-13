import { renderToBuffer } from "@react-pdf/renderer";
import { isMonthHiddenByFreePlan, freePlanHiddenResponse } from "@/lib/domain/plans";
import { verifySession, getActiveMembership } from "@/lib/auth/session";
import { canManageAny } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { getStaffTeamIds } from "@/lib/domain/teams";
import { buildSalarySlipPdfLines, resolveWorkplaceNamesByShiftId, type ComputedWorkLine } from "@/lib/domain/payroll";
import { sanitizeExpenses } from "@/lib/staffInvoiceTotals";
import { StaffInvoiceDocument } from "@/lib/pdf/staffInvoice";

const STATUS_LABEL: Record<string, string | null> = { SUBMITTED: "確認中", RETURNED: "差し戻し", APPROVED: null };

// 業務委託のスタッフの請求書のPDF。見られるのは、本人と、その請求書を開いた（1件分を精算した）会社の
// 支払明細を扱える人（本部の管理者・編集者と、そのスタッフのチームのマネージャー）だけ。下書きは出さない。
export async function GET(_request: Request, { params }: RouteContext<"/api/staff-invoices/[id]/pdf">) {
  const { id } = await params;
  const { userId } = await verifySession();
  const invoice = await prisma.staffInvoice.findUnique({ where: { id }, include: { company: { select: { name: true } } } });
  if (!invoice || invoice.status === "DRAFT" || !invoice.submittedAt) return new Response("not found", { status: 404 });

  if (invoice.staffUserId !== userId) {
    const membership = await getActiveMembership(userId);
    if (!membership || membership.companyId !== invoice.companyId) return new Response("forbidden", { status: 403 });
    if (!canManageAny(membership, await getStaffTeamIds(invoice.staffUserId))) return new Response("forbidden", { status: 403 });
    // 開く前（1件分を精算する前）は中身を見せない
    if (!invoice.chargeSettledAt) return new Response("forbidden", { status: 403 });
    if (await isMonthHiddenByFreePlan(invoice.companyId, invoice.targetMonth)) return freePlanHiddenResponse();
  }

  const workLines = invoice.workLines as ComputedWorkLine[];
  const workplaceMap = await resolveWorkplaceNamesByShiftId(workLines.map((l) => l.shiftId));
  const grouped = buildSalarySlipPdfLines(
    workLines.map((l) => ({ ...l, kind: "SHIFT" })),
    workplaceMap,
    { groupShiftLines: true },
  );
  const buffer = await renderToBuffer(
    <StaffInvoiceDocument
      data={{
        companyName: invoice.company.name,
        targetMonth: invoice.targetMonth,
        periodRangeLabel: invoice.periodRangeLabel,
        submittedAt: new Date(invoice.submittedAt.getTime() + 9 * 3600e3).toISOString().slice(0, 10),
        statusLabel: STATUS_LABEL[invoice.status] ?? null,
        issuerName: invoice.issuerName ?? "",
        issuerAddress: invoice.issuerAddress,
        registrationNumber: invoice.registrationNumber,
        lines: grouped.map((l) => ({
          description: l.description.replace(/（日給）$/, ""),
          hours: l.hours,
          rate: l.rate,
          amount: l.amount,
          isDaily: l.description.endsWith("（日給）"),
        })),
        expenses: sanitizeExpenses(invoice.expenses),
        workSubtotal: invoice.workSubtotal,
        taxExclusive: invoice.taxExclusive,
        taxAmount: invoice.taxAmount,
        withholding: invoice.withholding,
        withholdingAmount: invoice.withholdingAmount,
        expensesTotal: invoice.expensesTotal,
        total: invoice.total,
        bank: {
          bankName: invoice.bankName,
          branchName: invoice.branchName,
          accountType: invoice.accountType,
          accountNumber: invoice.accountNumber,
          accountHolderName: invoice.accountHolderName,
        },
        note: invoice.note,
      }}
    />,
  );
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="invoice-${invoice.targetMonth}.pdf"`,
    },
  });
}
