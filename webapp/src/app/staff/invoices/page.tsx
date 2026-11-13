import Link from "next/link";
import { requireCompanyStaffRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { todayJstParts } from "@/lib/date";
import { getStaffInvoiceForStaff, isValidTargetMonth, listContractorCompanies } from "@/lib/domain/staffInvoices";
import { StaffInvoiceEditor } from "@/components/staff/StaffInvoiceEditor";
import { MonthNavBar } from "@/components/company/MonthNavBar";
import { CreateRecordButton } from "@/components/company/CreateRecordButton";
import { PdfLink } from "@/components/PdfLink";

const STATUS_CHIP: Record<string, { text: string; className: string }> = {
  RETURNED: { text: "差し戻し", className: "bg-red-100 text-red-800" },
  SUBMITTED: { text: "確認中", className: "bg-amber-100 text-amber-800" },
  APPROVED: { text: "承認済み", className: "bg-emerald-100 text-emerald-800" },
};

// 業務委託のスタッフが会社へ出す請求書。会社画面の「給料明細／請求書」と同じ並び
// （月の切り替え → 下書き中＋「＋新しく作成」 → 提出済み）にして、開くと作成画面になる。
export default async function StaffInvoicesPage({ searchParams }: PageProps<"/staff/invoices">) {
  const { userId } = await requireCompanyStaffRole();
  const sp = await searchParams;
  const companies = await listContractorCompanies(userId);
  if (companies.length === 0) {
    return (
      <main className="mx-auto w-full max-w-2xl px-6 py-10">
        <h1 className="mb-4 font-serif-jp text-xl font-bold text-primary">請求書</h1>
        <p className="text-sm text-muted">請求書は、業務委託の契約がある会社にだけ出せます。</p>
      </main>
    );
  }
  const today = todayJstParts();
  const thisMonth = `${today.year}-${String(today.month).padStart(2, "0")}`;
  // 何も選んでいなければ先月（月が明けてから前の月の分を出すのが普通のため）
  const lastMonthDate = new Date(Date.UTC(today.year, today.month - 2, 1));
  const lastMonth = `${lastMonthDate.getUTCFullYear()}-${String(lastMonthDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const targetMonth = typeof sp.month === "string" && isValidTargetMonth(sp.month) ? sp.month : lastMonth;
  const companyId = typeof sp.company === "string" && companies.some((c) => c.id === sp.company) ? sp.company : null;

  if (companyId) {
    const invoice = await getStaffInvoiceForStaff(userId, companyId, targetMonth);
    const companyName = companies.find((c) => c.id === companyId)!.name;
    const [y, m] = targetMonth.split("-").map(Number);
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
        <Link href={`/staff/invoices?month=${targetMonth}`} className="mb-4 inline-block text-sm text-primary underline">
          ← 一覧に戻る
        </Link>
        <div className="mb-4">
          <h1 className="font-serif-jp text-xl font-bold text-primary">{companyName}</h1>
          <p className="text-sm text-muted">
            {y}年{m}月分の請求書
            {invoice.periodRangeLabel ? `（対象期間：${invoice.periodRangeLabel}）` : ""}
          </p>
        </div>
        <StaffInvoiceEditor key={`${companyId}-${targetMonth}`} companyId={companyId} companyName={companyName} targetMonth={targetMonth} invoice={invoice} />
      </main>
    );
  }

  const invoices = await prisma.staffInvoice.findMany({
    where: { staffUserId: userId, targetMonth, companyId: { in: companies.map((c) => c.id) } },
    include: { company: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const drafts = invoices.filter((i) => i.status === "DRAFT" || i.status === "RETURNED");
  const submitted = invoices.filter((i) => i.status === "SUBMITTED" || i.status === "APPROVED");
  const companiesWithInvoice = new Set(invoices.map((i) => i.companyId));
  const availableCompanies = companies.filter((c) => !companiesWithInvoice.has(c.id));
  const row = "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-white/60 px-4 py-2 text-sm";

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="mb-4 font-serif-jp text-xl font-bold text-primary">請求書</h1>
      <MonthNavBar basePath="/staff/invoices" targetMonth={targetMonth} minMonth={null} todayMonth={thisMonth} />

      <section data-testid="staff-invoice-drafts">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif-jp text-lg font-bold text-primary">下書き中</h2>
          {availableCompanies.length > 0 ? (
            <CreateRecordButton
              basePath="/staff/invoices"
              targetMonth={targetMonth}
              paramName="company"
              label="請求先の会社"
              options={availableCompanies.map((c) => ({ id: c.id, name: c.name }))}
            />
          ) : null}
        </div>
        {drafts.length === 0 ? (
          <p className="text-sm text-muted">下書き中の請求書はありません。</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {drafts.map((i) => (
              <li key={i.id}>
                <Link href={`/staff/invoices?month=${targetMonth}&company=${i.companyId}`} className={`${row} hover:bg-background`}>
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{i.company.name}</span>
                    {STATUS_CHIP[i.status] ? (
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CHIP[i.status].className}`}>{STATUS_CHIP[i.status].text}</span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10" data-testid="staff-invoice-submitted">
        <h2 className="mb-3 font-serif-jp text-lg font-bold text-primary">提出済み</h2>
        {submitted.length === 0 ? (
          <p className="text-sm text-muted">この月に提出した請求書はありません。</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {submitted.map((i) => (
              <li key={i.id} className={row}>
                <Link href={`/staff/invoices?month=${targetMonth}&company=${i.companyId}`} className="flex items-center gap-2 font-medium text-primary underline">
                  {i.company.name}
                  <span className={`rounded-full px-2 py-0.5 text-xs no-underline ${STATUS_CHIP[i.status].className}`}>{STATUS_CHIP[i.status].text}</span>
                </Link>
                <span className="text-muted">{i.total.toLocaleString()}円</span>
                <PdfLink href={`/api/staff-invoices/${i.id}/pdf`} className="text-xs text-primary underline">
                  PDF
                </PdfLink>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
