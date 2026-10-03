import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { verifySession, getActiveMembership } from "@/lib/auth/session";
import { isCompanyScopeAdmin } from "@/lib/auth/permissions";
import { listClients } from "@/lib/domain/relationships";
import { listInvoicesForCompany } from "@/lib/domain/invoicing";
import { prisma } from "@/lib/prisma";
import { InvoiceDocument, type InvoicePdfData } from "@/lib/pdf/invoice";

export async function GET(request: Request) {
  const { userId } = await verifySession();
  const membership = await getActiveMembership(userId);
  if (!membership || membership.role === "STAFF") return new Response("forbidden", { status: 403 });

  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  if (!month) return new Response("month required", { status: 400 });

  const allClients = await listClients(membership.companyId);
  let clients = allClients;
  if (!isCompanyScopeAdmin(membership)) {
    const myTeamIds = membership.teamMemberships.map((tm) => tm.teamId);
    const links = await prisma.teamClientRelationship.findMany({
      where: { teamId: { in: myTeamIds }, companyRelationshipId: { in: allClients.map((c) => c.id) } },
      select: { companyRelationshipId: true },
    });
    const allowedIds = new Set(links.map((l) => l.companyRelationshipId));
    clients = allClients.filter((c) => allowedIds.has(c.id));
  }
  const accessibleClientIds = new Set(clients.map((c) => c.id));

  const invoicesThisMonth = (await listInvoicesForCompany(membership.companyId, month)).filter(
    (inv) => inv.status === "ISSUED" && accessibleClientIds.has(inv.companyRelationshipId),
  );
  if (invoicesThisMonth.length === 0) return new Response("no issued invoices", { status: 404 });

  const issuingCompany = await prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } });

  const mergedPdf = await PDFDocument.create();
  for (const invoice of invoicesThisMonth) {
    const latestIssue = invoice.issues.reduce((latest, i) => (i.issuedAt > latest.issuedAt ? i : latest));
    const snap = latestIssue.snapshot as unknown as Record<string, unknown>;
    const clientName = invoice.companyRelationship.clientCompany?.name ?? invoice.companyRelationship.proxyName ?? "";
    const data: InvoicePdfData = {
      issuingCompanyName: issuingCompany.name,
      issuingCompanyAddress: issuingCompany.address,
      issuingCompanyPhoneNumber: issuingCompany.phoneNumber,
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
    const buffer = await renderToBuffer(<InvoiceDocument data={data} />);
    const sourcePdf = await PDFDocument.load(buffer);
    const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    for (const page of copiedPages) mergedPdf.addPage(page);
  }

  const mergedBytes = await mergedPdf.save();

  return new Response(new Uint8Array(mergedBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="invoices-${month}.pdf"`,
    },
  });
}
