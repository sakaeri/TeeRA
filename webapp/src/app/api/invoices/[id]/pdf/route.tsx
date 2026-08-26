import { renderToBuffer } from "@react-pdf/renderer";
import { verifySession, getActiveMembership } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { computeInvoiceTotals } from "@/lib/domain/invoicing";
import { todayJst } from "@/lib/date";
import { InvoiceDocument, type InvoicePdfData } from "@/lib/pdf/invoice";

export async function GET(request: Request, { params }: RouteContext<"/api/invoices/[id]/pdf">) {
  const { id } = await params;
  const { userId } = await verifySession();
  const membership = await getActiveMembership(userId);
  if (!membership) return new Response("forbidden", { status: 403 });

  const url = new URL(request.url);
  const issueId = url.searchParams.get("issueId");

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      issuingCompany: true,
      companyRelationship: { include: { clientCompany: true } },
    },
  });
  if (!invoice) return new Response("not found", { status: 404 });
  if (membership.companyId !== invoice.issuingCompanyId || membership.role === "STAFF") {
    return new Response("forbidden", { status: 403 });
  }

  const clientName = invoice.companyRelationship.clientCompany?.name ?? invoice.companyRelationship.proxyName ?? "";

  let data: InvoicePdfData;
  if (issueId) {
    const issue = await prisma.invoiceIssue.findUnique({ where: { id: issueId } });
    if (!issue || issue.invoiceId !== invoice.id) return new Response("not found", { status: 404 });
    const snap = issue.snapshot as unknown as Record<string, unknown>;
    data = {
      issuingCompanyName: invoice.issuingCompany.name,
      clientName,
      periodLabel: snap.periodLabel as string,
      dueDate: (snap.dueDate as string | undefined)?.slice(0, 10) ?? null,
      note: snap.note as string | null,
      issuedAt: (snap.issuedAt as string).slice(0, 10),
      registered: snap.registered as boolean,
      invoiceRegistrationNumber: snap.invoiceRegistrationNumber as string | null,
      lines: snap.lines as InvoicePdfData["lines"],
      brackets: snap.brackets as InvoicePdfData["brackets"],
      subtotalAll: snap.subtotalAll as number,
      taxAll: snap.taxAll as number,
      total: snap.total as number,
      watermarked: false,
    };
  } else {
    const registered = Boolean(invoice.invoiceRegistrationNumberSnapshot);
    const totals = computeInvoiceTotals({ lines: invoice.lines, registered });
    data = {
      issuingCompanyName: invoice.issuingCompany.name,
      clientName,
      periodLabel: invoice.periodLabel,
      dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
      note: invoice.note,
      issuedAt: todayJst(),
      registered,
      invoiceRegistrationNumber: invoice.invoiceRegistrationNumberSnapshot,
      lines: invoice.lines,
      ...totals,
      watermarked: true,
    };
  }

  const buffer = await renderToBuffer(<InvoiceDocument data={data} />);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="invoice-${invoice.periodLabel}.pdf"`,
    },
  });
}
