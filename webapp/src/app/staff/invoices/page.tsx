import Link from "next/link";
import { requireCompanyStaffRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { todayJstParts } from "@/lib/date";
import { getStaffInvoiceForStaff, isValidTargetMonth, listContractorCompanies } from "@/lib/domain/staffInvoices";
import { StaffInvoiceEditor } from "@/components/staff/StaffInvoiceEditor";

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "下書き",
  SUBMITTED: "確認中",
  RETURNED: "差し戻し",
  APPROVED: "承認済み",
};

// 業務委託のスタッフが、会社へ請求書を出す画面（承認済みの業務報告から下書きができる）
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
  const companyId =
    typeof sp.company === "string" && companies.some((c) => c.id === sp.company) ? sp.company : companies[0].id;
  // 何も選んでいなければ先月分（月が明けてから前の月の分を出すのが普通のため）
  const today = todayJstParts();
  const thisMonth = `${today.year}-${String(today.month).padStart(2, "0")}`;
  const targetMonth = typeof sp.month === "string" && isValidTargetMonth(sp.month) && sp.month <= thisMonth ? sp.month : shiftMonth(thisMonth, -1);
  const [invoice, history] = await Promise.all([
    getStaffInvoiceForStaff(userId, companyId, targetMonth),
    prisma.staffInvoice.findMany({
      where: { staffUserId: userId, companyId },
      orderBy: { targetMonth: "desc" },
      take: 12,
      select: { id: true, targetMonth: true, status: true, total: true },
    }),
  ]);
  const companyName = companies.find((c) => c.id === companyId)!.name;
  const [y, m] = targetMonth.split("-").map(Number);
  const href = (month: string, company = companyId) => `/staff/invoices?company=${company}&month=${month}`;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="mb-4 font-serif-jp text-xl font-bold text-primary">請求書</h1>
      {companies.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {companies.map((c) => (
            <Link
              key={c.id}
              href={href(targetMonth, c.id)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${c.id === companyId ? "border-primary bg-primary text-primary-foreground" : "border-border bg-white text-primary"}`}
            >
              {c.name}
            </Link>
          ))}
        </div>
      ) : null}
      <div className="mb-4 flex items-center justify-between rounded-2xl bg-white px-3 py-2 shadow-sm ring-1 ring-black/5">
        <Link href={href(shiftMonth(targetMonth, -1))} className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm text-primary" aria-label="前の月">
          ‹ 前月
        </Link>
        <span className="min-w-0 text-center text-sm font-semibold text-primary">
          <span className="block truncate text-xs font-normal text-muted">{companyName}</span>
          {y}年{m}月分
        </span>
        {targetMonth < thisMonth ? (
          <Link href={href(shiftMonth(targetMonth, 1))} className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm text-primary" aria-label="次の月">
            翌月 ›
          </Link>
        ) : (
          <span className="shrink-0 whitespace-nowrap px-2 py-1.5 text-sm text-transparent">翌月 ›</span>
        )}
      </div>

      <StaffInvoiceEditor key={`${companyId}-${targetMonth}`} companyId={companyId} companyName={companyName} targetMonth={targetMonth} invoice={invoice} />

      {history.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-muted">これまでの請求書</h2>
          <ul className="flex flex-col gap-1.5">
            {history.map((h) => {
              const [hy, hm] = h.targetMonth.split("-").map(Number);
              return (
                <li key={h.id}>
                  <Link
                    href={href(h.targetMonth)}
                    className="flex items-center justify-between rounded-xl bg-white px-4 py-2.5 text-sm shadow-sm ring-1 ring-black/5"
                  >
                    <span>
                      {hy}年{hm}月分
                      <span className="ml-2 rounded-full bg-background px-2 py-0.5 text-[11px] text-muted">{STATUS_LABEL[h.status]}</span>
                    </span>
                    {h.status !== "DRAFT" ? <span className="font-semibold text-primary">{h.total.toLocaleString()}円</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
