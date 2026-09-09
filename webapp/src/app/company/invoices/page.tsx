import { redirect } from "next/navigation";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManageAny, isCompanyScopeAdmin } from "@/lib/auth/permissions";
import { listClients } from "@/lib/domain/relationships";
import { getOrCreateInvoice, computeInvoiceTotals, listIssuedInvoicesForCompany } from "@/lib/domain/invoicing";
import { pdfQuotaRemaining } from "@/lib/domain/plans";
import { prisma } from "@/lib/prisma";
import { InvoiceEditor } from "@/components/company/InvoiceEditor";
import { FinanceTabs } from "@/components/company/FinanceTabs";
import { MonthNavFilterBar } from "@/components/company/MonthNavFilterBar";
import { todayJstParts, earliestAllowedMonth, cutoffMonthString } from "@/lib/date";
import Link from "next/link";

function currentMonth() {
  const today = todayJstParts();
  return `${today.year}-${String(today.month).padStart(2, "0")}`;
}

function monthLabel(periodLabel: string) {
  const [year, month] = periodLabel.split("-");
  return `${year}年${Number(month)}月`;
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
  const requestedMonth = typeof sp.month === "string" ? sp.month : currentMonth();
  const companyRelationshipId = typeof sp.client === "string" ? sp.client : undefined;

  const historyCutoff = earliestAllowedMonth(company.planTier);
  const minMonth = cutoffMonthString(historyCutoff);
  if (minMonth && requestedMonth < minMonth) {
    const params = new URLSearchParams({ month: minMonth });
    if (companyRelationshipId) params.set("client", companyRelationshipId);
    redirect(`/company/invoices?${params.toString()}`);
  }
  const periodLabel = requestedMonth;
  // カレンダー/スタッフ詳細パネルと同様、カットオフ月そのものを見ている
  // 時だけバナーを出す（無料プランというだけで常時表示すると邪魔になる）。
  const atHistoryCutoff = minMonth !== null && periodLabel === minMonth;

  const allClients = await listClients(membership.companyId);
  // チームマネージャー/リーダーは自チームに紐づく取引先しか選べない（本部
  // 管理者/編集者は全社分）。
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
    unresolved: { shiftId: string; date: string; staffName: string; taskName: string | null }[];
  };

  let invoiceData: InvoiceData | null = null;
  const targetClientTeamIds = companyRelationshipId
    ? (await prisma.teamClientRelationship.findMany({ where: { companyRelationshipId }, select: { teamId: true } })).map((r) => r.teamId)
    : [];
  if (companyRelationshipId && canManageAny(membership, targetClientTeamIds)) {
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
      unresolved: invoice.unresolved,
    };
  }

  // 発行履歴一覧 — 発行済みのものだけを月ごとにまとめる。チームマネージャー/
  // リーダーは自チームに紐づく取引先分だけに絞る。
  const accessibleClientIds = new Set(clients.map((c) => c.id));
  const allIssuedInvoices = await listIssuedInvoicesForCompany(membership.companyId, minMonth ?? undefined);
  const issuedInvoices = allIssuedInvoices.filter((inv) => accessibleClientIds.has(inv.companyRelationshipId));
  const pdfQuota = await pdfQuotaRemaining(membership.companyId);
  const issuedByMonth = new Map<string, typeof issuedInvoices>();
  for (const inv of issuedInvoices) {
    const list = issuedByMonth.get(inv.periodLabel) ?? [];
    list.push(inv);
    issuedByMonth.set(inv.periodLabel, list);
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-8 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">請求書</h1>
      <FinanceTabs active="invoices" invoicesEnabled={company.agencyEnabled} />

      {atHistoryCutoff ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-accent/10 px-3 py-2 text-xs text-primary">
          <span>無料プランでは過去データの閲覧は直近3ヶ月までです。それ以前を見るにはプランのアップグレードが必要です。</span>
          <Link href="/company/wallet" className="shrink-0 font-semibold underline whitespace-nowrap">
            プランをアップグレードする
          </Link>
        </div>
      ) : null}

      {pdfQuota.quota > 0 ? (
        <p className="mb-4 text-xs text-muted">
          今月の無料発行枠（給与明細・請求書の合算）：残り{pdfQuota.remaining}/{pdfQuota.quota}件
        </p>
      ) : null}

      <MonthNavFilterBar
        basePath="/company/invoices"
        targetMonth={periodLabel}
        minMonth={minMonth}
        todayMonth={currentMonth()}
        extraParamName="client"
        extraParamValue={companyRelationshipId}
        extraLabel="依頼主"
        extraOptions={clients.map((c) => ({ id: c.id, name: c.clientCompany?.name ?? c.proxyName ?? "" }))}
      />

      {invoiceData ? (
        <InvoiceEditor invoice={invoiceData} willUseFreeQuota={pdfQuota.quota > 0 && pdfQuota.remaining > 0} />
      ) : (
        <p className="text-sm text-muted">対象月と依頼主を選択してください。</p>
      )}

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

      <section className="mt-10">
        <h2 className="mb-3 font-serif-jp text-lg font-bold text-primary">発行履歴</h2>
        {issuedByMonth.size === 0 ? (
          <p className="text-sm text-muted">まだ発行された請求書はありません。</p>
        ) : (
          <div className="flex flex-col gap-6">
            {[...issuedByMonth.entries()].map(([month, invoicesForMonth]) => (
              <div key={month}>
                <h3 className="mb-2 text-sm font-semibold text-muted">{monthLabel(month)}</h3>
                <ul className="flex flex-col gap-1">
                  {invoicesForMonth.map((inv) => {
                    const registered = Boolean(inv.invoiceRegistrationNumberSnapshot);
                    const totals = computeInvoiceTotals({ lines: inv.lines, registered });
                    return (
                      <li
                        key={inv.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-white/60 px-4 py-2 text-sm"
                      >
                        <span className="font-medium">
                          {inv.companyRelationship.clientCompany?.name ?? inv.companyRelationship.proxyName}
                        </span>
                        <span className="text-muted">{totals.total}円</span>
                        <div className="flex flex-wrap gap-3">
                          {inv.issues.map((i) => (
                            <Link
                              key={i.id}
                              href={`/api/invoices/${inv.id}/pdf?issueId=${i.id}`}
                              target="_blank"
                              className="text-xs text-primary underline"
                            >
                              PDF（{new Date(i.issuedAt).toLocaleString("ja-JP")}）
                            </Link>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
