import Link from "next/link";

const ROLE_LABEL: Record<string, string> = {
  COMPANY_ADMIN: "管理者",
  COMPANY_EDITOR: "編集者",
  STAFF: "スタッフ",
};

type CompanyRow = { companyId: string; companyName: string; role: string; pendingCount: number };

export function StaffAffiliationsView({ companies }: { companies: CompanyRow[] }) {
  return (
    <ul className="flex flex-col gap-3">
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
