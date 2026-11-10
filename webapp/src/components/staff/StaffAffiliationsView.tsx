import Link from "next/link";
import { PayslipIcon, InvoiceIcon, HowtoIcon } from "@/components/staff/StaffMenuIcons";

const ROLE_LABEL: Record<string, string> = {
  COMPANY_ADMIN: "管理者",
  COMPANY_EDITOR: "編集者",
  STAFF: "スタッフ",
};

type CompanyRow = { companyId: string; companyName: string; role: string; pendingCount: number };

export function StaffAffiliationsView({ companies, isContractor = false }: { companies: CompanyRow[]; isContractor?: boolean }) {
  return (
    <ul className="flex flex-col gap-3">
      {/* 給料明細・（業務委託の人は）請求書・使い方への入口（右上のメニューにもある） */}
      <li className={`grid gap-3 ${isContractor ? "grid-cols-3" : "grid-cols-2"}`}>
        {[
          { href: "/staff/payslips", label: "給料明細", icon: <PayslipIcon className="h-6 w-6" />, show: true },
          { href: "/staff/invoices", label: "請求書", icon: <InvoiceIcon className="h-6 w-6" />, show: isContractor },
          { href: "/staff/howto", label: "使い方", icon: <HowtoIcon className="h-6 w-6" />, show: true },
        ]
          .filter((item) => item.show)
          .map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-white/60 px-2 py-3 text-xs font-semibold text-primary hover:border-primary"
            >
              {item.icon}
              <span className="whitespace-nowrap">{item.label}</span>
            </Link>
          ))}
      </li>
      {companies.map((c) => (
        <li key={c.companyId}>
          <Link
            href={`/staff/contracts/${c.companyId}`}
            className="flex items-center justify-between rounded-2xl border border-border bg-white/60 p-5 hover:border-primary"
          >
            <div>
              <p className="font-serif-jp text-lg font-bold text-primary">{c.companyName}</p>
              <p className="mt-1 text-xs text-muted">{ROLE_LABEL[c.role] ?? c.role}として所属</p>
            </div>
            <div className="flex items-center gap-2">
              {c.pendingCount > 0 ? (
                <span className="rounded-full bg-accent/20 px-2.5 py-1 text-xs font-semibold text-accent">
                  要確認（{c.pendingCount}）
                </span>
              ) : null}
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-muted">
                <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </Link>
        </li>
      ))}
      {companies.length === 0 ? <p className="text-center text-muted">所属先がありません。</p> : null}
    </ul>
  );
}
