import { redirect } from "next/navigation";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManage } from "@/lib/auth/permissions";
import { listClients } from "@/lib/domain/relationships";
import { getOrCreateInvoice, computeInvoiceTotals } from "@/lib/domain/invoicing";
import { prisma } from "@/lib/prisma";
import { InvoiceEditor } from "@/components/company/InvoiceEditor";
import { todayJstParts } from "@/lib/date";
import Link from "next/link";

function currentMonth() {
  const today = todayJstParts();
  return `${today.year}-${String(today.month).padStart(2, "0")}`;
}

export default async function InvoicesPage({
  searchParams,
}: PageProps<"/company/invoices">) {
  const { membership } = await requireCompanyAdminOrEditor();
  const company = await prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } });
  if (!company.agencyEnabled) {
    redirect("/company/roster");
  }

  const sp = await searchParams;
  const periodLabel = typeof sp.month === "string" ? sp.month : currentMonth();
  const companyRelationshipId = typeof sp.client === "string" ? sp.client : undefined;

  const clients = await listClients(membership.companyId);

  type InvoiceData = {
    id: string;
    status: string;
    dueDate: string;
    note: string;
    invoiceRegistrationNumber: string;
    registered: boolean;
    lines: { id: string; staffName: string; description: string; hours: number; rate: number; amount: number; taxRatePercent: number }[];
    totals: ReturnType<typeof computeInvoiceTotals>;
    issues: { id: string; issuedAt: string }[];
  };

  let invoiceData: InvoiceData | null = null;
  if (companyRelationshipId && canManage(membership)) {
    const invoice = await getOrCreateInvoice({
      issuingCompanyId: membership.companyId,
      companyRelationshipId,
      periodLabel,
    });
    const registered = Boolean(invoice.invoiceRegistrationNumberSnapshot);
    const totals = computeInvoiceTotals({ lines: invoice.lines, registered });
    const issues = await prisma.invoiceIssue.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { issuedAt: "desc" },
    });
    invoiceData = {
      id: invoice.id,
      status: invoice.status,
      dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? "",
      note: invoice.note ?? "",
      invoiceRegistrationNumber: invoice.invoiceRegistrationNumberSnapshot ?? "",
      registered,
      lines: invoice.lines.map((l) => ({
        id: l.id,
        staffName: l.staffName,
        description: l.description,
        hours: l.hours,
        rate: l.rate,
        amount: l.amount,
        taxRatePercent: l.taxRatePercent,
      })),
      totals,
      issues: issues.map((i) => ({ id: i.id, issuedAt: i.issuedAt.toISOString() })),
    };
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-8 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">請求書</h1>

      <form method="get" className="mb-6 flex items-end gap-3 rounded-xl border border-border bg-white/60 p-4">
        <label className="flex flex-col gap-1 text-xs">
          対象月
          <input type="month" name="month" defaultValue={periodLabel} className="rounded-lg border border-border px-2 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          依頼主
          <select name="client" defaultValue={companyRelationshipId} className="rounded-lg border border-border px-2 py-2 text-sm">
            <option value="">選択してください</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.clientCompany?.name ?? c.proxyName}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          開く
        </button>
      </form>

      {invoiceData ? <InvoiceEditor invoice={invoiceData} /> : <p className="text-sm text-muted">対象月と依頼主を選択してください。</p>}

      {invoiceData?.issues.length ? (
        <div className="mt-6 text-sm">
          {invoiceData.issues.map((i) => (
            <Link
              key={i.id}
              href={`/api/invoices/${invoiceData!.id}/pdf?issueId=${i.id}`}
              target="_blank"
              className="mr-4 text-primary underline"
            >
              PDF ({new Date(i.issuedAt).toLocaleString("ja-JP")})
            </Link>
          ))}
        </div>
      ) : null}
    </main>
  );
}
