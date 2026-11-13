import { redirect } from "next/navigation";
import { closingDayLabel } from "@/lib/closingPeriod";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManageAny, isCompanyScopeAdmin, isLeaderOnly } from "@/lib/auth/permissions";
import { listClients } from "@/lib/domain/relationships";
import { invoicePeriod, getOrCreateInvoice, computeInvoiceTotals, listInvoicesForCompany, listBankAccounts } from "@/lib/domain/invoicing";
import { pdfQuotaRemaining } from "@/lib/domain/plans";
import { prisma } from "@/lib/prisma";
import { InvoiceEditor } from "@/components/company/InvoiceEditor";
import { FinanceTabs } from "@/components/company/FinanceTabs";
import { MonthNavBar } from "@/components/company/MonthNavBar";
import { CreateRecordButton } from "@/components/company/CreateRecordButton";
import { todayJstParts, earliestAllowedMonth, cutoffMonthString } from "@/lib/date";
import Link from "next/link";
import { PdfLink } from "@/components/PdfLink";

function currentMonth() {
  const today = todayJstParts();
  return `${today.year}-${String(today.month).padStart(2, "0")}`;
}

// 何も選んでいなければ先月を開く（月が明けてから前の月の分を作ることが多いため）
function previousMonth() {
  const today = todayJstParts();
  const d = new Date(Date.UTC(today.year, today.month - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function InvoicesPage({
  searchParams,
}: PageProps<"/company/invoices">) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (isLeaderOnly(membership)) redirect("/company/calendar");
  const company = await prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } });
  if (!company.agencyEnabled) {
    redirect("/company/roster");
  }

  const sp = await searchParams;
  const requestedMonth = typeof sp.month === "string" ? sp.month : previousMonth();
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
    bankName: string;
    branchName: string;
    accountType: string;
    accountNumber: string;
    accountHolderName: string;
    lines: { id: string; staffName: string; description: string; hours: number; unit: string | null; rate: number; amount: number; taxRatePercent: number }[];
    totals: ReturnType<typeof computeInvoiceTotals>;
    issues: { id: string; issuedAt: string }[];
    unresolved: { shiftId: string; date: string; staffName: string; taskName: string | null }[];
    groupLinesByTask: boolean;
    attachWorkRecord: boolean;
  };

  let invoiceData: InvoiceData | null = null;
  let invoicePeriodRange: string | null = null;
  let invoiceClosingLabel = "";
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
    // 締め日が末日でない依頼主は、対象期間を画面に出す
    const period = await invoicePeriod(companyRelationshipId, periodLabel);
    invoicePeriodRange = period.rangeLabel;
    invoiceClosingLabel = closingDayLabel(period.closingDay);
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
      bankName: invoice.bankName ?? "",
      branchName: invoice.branchName ?? "",
      accountType: invoice.accountType ?? "",
      accountNumber: invoice.accountNumber ?? "",
      accountHolderName: invoice.accountHolderName ?? "",
      lines: invoice.lines.map((l) => ({
        id: l.id,
        staffName: l.staffName,
        description: l.description,
        hours: l.hours,
        unit: l.unit,
        rate: l.rate,
        amount: l.amount,
        taxRatePercent: l.taxRatePercent,
      })),
      totals,
      issues: issues.map((i) => ({ id: i.id, issuedAt: i.issuedAt.toISOString() })),
      unresolved: invoice.unresolved,
      groupLinesByTask: invoice.groupLinesByTask,
      attachWorkRecord: invoice.attachWorkRecord,
    };
  }

  // 対象月の一覧 — 月と依頼主選択は別物なので、表示中の月に存在する
  // 請求書（下書き/発行済み）を「下書き中」「発行履歴」に分けて表示する。
  // チームマネージャー/リーダーは自チームに紐づく取引先分だけに絞る。
  const accessibleClientIds = new Set(clients.map((c) => c.id));
  const invoicesThisMonth = (await listInvoicesForCompany(membership.companyId, periodLabel)).filter((inv) =>
    accessibleClientIds.has(inv.companyRelationshipId),
  );
  const pdfQuota = await pdfQuotaRemaining(membership.companyId, periodLabel);
  const bankAccounts = invoiceData ? await listBankAccounts(membership.companyId) : [];
  const draftInvoices = invoicesThisMonth.filter((inv) => inv.status !== "ISSUED");
  const issuedInvoices = invoicesThisMonth.filter((inv) => inv.status === "ISSUED");
  // ＋新しく作成の選択肢は、この月にまだ何も無い依頼主だけに絞る
  // （既にある人は下書き中/発行履歴の行から直接開けるため）。
  const clientsWithRecordIds = new Set(invoicesThisMonth.map((inv) => inv.companyRelationshipId));
  const clientsAvailableForNewInvoice = clients.filter((c) => !clientsWithRecordIds.has(c.id));
  const selectedClient = companyRelationshipId ? allClients.find((c) => c.id === companyRelationshipId) : undefined;
  const selectedClientName = selectedClient?.clientCompany?.name ?? selectedClient?.proxyName ?? "";

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8 sm:py-10">
      <FinanceTabs active="invoices" invoicesEnabled={company.agencyEnabled} />

      {atHistoryCutoff ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-accent/10 px-3 py-2 text-xs text-primary">
          <span>無料プランでは過去データの閲覧は直近3ヶ月までです。それ以前を見るにはプランのアップグレードが必要です。</span>
          <Link href="/company/wallet" className="shrink-0 font-semibold underline whitespace-nowrap">
            プランをアップグレードする
          </Link>
        </div>
      ) : null}

      <MonthNavBar basePath="/company/invoices" targetMonth={periodLabel} minMonth={minMonth} todayMonth={currentMonth()} />

      {invoiceData ? (
        <>
          <Link href={`/company/invoices?month=${periodLabel}`} className="mb-4 inline-block text-sm text-primary underline">
            ← 一覧に戻る
          </Link>
          {invoicePeriodRange ? (
            <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900" data-testid="invoice-period-range">
              対象期間：{invoicePeriodRange}（この依頼主は{invoiceClosingLabel}）
            </p>
          ) : null}
          <InvoiceEditor
            invoice={invoiceData}
            clientName={selectedClientName}
            clientRelationshipId={companyRelationshipId}
            bankAccounts={bankAccounts.map((a) => ({
              id: a.id,
              bankName: a.bankName,
              branchName: a.branchName ?? "",
              accountType: a.accountType ?? "",
              accountNumber: a.accountNumber,
              accountHolderName: a.accountHolderName,
            }))}
            willUseFreeQuota={pdfQuota.unlimited || (pdfQuota.quota > 0 && pdfQuota.remaining > 0)}
            pdfQuota={
              pdfQuota.unlimited || pdfQuota.quota > 0
                ? { remaining: pdfQuota.remaining, quota: pdfQuota.quota, unlimited: pdfQuota.unlimited, monthLabel: `${Number(periodLabel.slice(5, 7))}月分` }
                : null
            }
          />
          {invoiceData.issues.length ? (
            <div className="mt-6">
              <p className="mb-1.5 text-xs text-muted">発行履歴</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {invoiceData.issues.map((i, index) => (
                  <PdfLink
                    key={i.id}
                    href={`/api/invoices/${invoiceData!.id}/pdf?issueId=${i.id}`}
                    // 最新の発行分（issuesはissuedAt降順）だけ目立たせ、
                    // 過去分は薄い色にして見分けやすくする。
                    className={index === 0 ? "font-semibold text-primary underline" : "text-muted underline"}
                  >
                    PDF ({new Date(i.issuedAt).toLocaleString("ja-JP")})
                  </PdfLink>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif-jp text-lg font-bold text-primary">下書き中</h2>
              <CreateRecordButton
                basePath="/company/invoices"
                targetMonth={periodLabel}
                paramName="client"
                label="依頼主"
                options={clientsAvailableForNewInvoice.map((c) => ({ id: c.id, name: c.clientCompany?.name ?? c.proxyName ?? "" }))}
              />
            </div>
            {draftInvoices.length === 0 ? (
              <p className="text-sm text-muted">下書き中の請求書はありません。</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {draftInvoices.map((inv) => (
                  <li key={inv.id}>
                    <Link
                      href={`/company/invoices?month=${periodLabel}&client=${inv.companyRelationshipId}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-white/60 px-4 py-2 text-sm hover:bg-background"
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-medium">
                          {inv.companyRelationship.clientCompany?.name ?? inv.companyRelationship.proxyName}
                        </span>
                        {inv.issues.length > 0 ? (
                          <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
                            発行済み（修正中）
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-10">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif-jp text-lg font-bold text-primary">発行履歴</h2>
              {issuedInvoices.length > 0 ? (
                <PdfLink
                  href={`/api/invoices/bulk-pdf?month=${periodLabel}`}
                  className="rounded-lg border border-primary px-3 py-1.5 text-xs text-primary hover:bg-primary/5"
                >
                  一括PDFダウンロード
                </PdfLink>
              ) : null}
            </div>
            {issuedInvoices.length === 0 ? (
              <p className="text-sm text-muted">この月に発行された請求書はありません。</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {issuedInvoices.map((inv) => {
                  const registered = Boolean(inv.invoiceRegistrationNumberSnapshot);
                  const totals = computeInvoiceTotals({ lines: inv.lines, registered });
                  // 一覧にはこの依頼主の最新発行分のPDFだけを出す。過去分は
                  // 詳細（編集画面）の発行履歴から辿れる。
                  const latestIssue = inv.issues.reduce((latest, i) =>
                    i.issuedAt > latest.issuedAt ? i : latest,
                  );
                  return (
                    <li
                      key={inv.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-white/60 px-4 py-2 text-sm"
                    >
                      <Link
                        href={`/company/invoices?month=${periodLabel}&client=${inv.companyRelationshipId}`}
                        className="font-medium text-primary underline"
                      >
                        {inv.companyRelationship.clientCompany?.name ?? inv.companyRelationship.proxyName}
                      </Link>
                      <span className="text-muted">{totals.total}円</span>
                      <PdfLink
                        href={`/api/invoices/${inv.id}/pdf?issueId=${latestIssue.id}`}
                        className="text-xs text-primary underline"
                      >
                        PDF（{new Date(latestIssue.issuedAt).toLocaleString("ja-JP")}）
                      </PdfLink>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
