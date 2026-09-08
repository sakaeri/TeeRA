import Link from "next/link";

// 給与明細と請求書は別ページ（別のドメイン/権限判定）のままだが、
// 「給料明細/請求書」という1つのサイドバー項目から行き来できるように
// タブ状の切り替えを両ページの先頭で共有する。請求書は依頼主・派遣モードが
// 有効な会社にしか意味を持たないため、invoicesEnabledがfalseなら
// タブ自体を出さない（invoices/page.tsx側の既存リダイレクトと一致させる）。
export function FinanceTabs({
  active,
  invoicesEnabled,
}: {
  active: "payroll" | "invoices";
  invoicesEnabled: boolean;
}) {
  if (!invoicesEnabled) return null;

  const tabs = [
    { key: "payroll" as const, href: "/company/payroll", label: "給料明細" },
    { key: "invoices" as const, href: "/company/invoices", label: "請求書" },
  ];

  return (
    <div className="mb-8 flex gap-1 border-b border-border">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`border-b-2 px-4 py-2 text-sm font-semibold ${
            active === t.key ? "border-accent text-primary" : "border-transparent text-muted"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
