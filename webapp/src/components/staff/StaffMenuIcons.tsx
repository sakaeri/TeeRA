// スタッフのアプリの「給料明細・請求書・使い方」の入口（右上のメニューと「設定」）で使う小さなアイコン
const common = { viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function PayslipIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...common} className={className} aria-hidden="true">
      <rect x="3.5" y="2.5" width="13" height="15" rx="2" />
      <path d="M7 7h6M7 10h6M7 13h3.5" />
    </svg>
  );
}

export function InvoiceIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...common} className={className} aria-hidden="true">
      <path d="M5 2.5h7l3.5 3.5v11.5H5z" />
      <path d="M12 2.5V6h3.5M8 10.5h5M8 13.5h5" />
    </svg>
  );
}

export function HowtoIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...common} className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M8 8a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.5M10 14.2v.1" />
    </svg>
  );
}

export function CompanyIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...common} className={className} aria-hidden="true">
      <path d="M3.5 17.5V5l6-2.5v15M9.5 7.5h7v10M2.5 17.5h15M6 8h1M6 11h1M6 14h1M12.5 10.5h1M12.5 13.5h1" />
    </svg>
  );
}

export function SwitchIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg {...common} className={className} aria-hidden="true">
      <path d="M4 7h11l-3-3M16 13H5l3 3" />
    </svg>
  );
}

export function ChevronIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...common} className={className} aria-hidden="true">
      <path d="M7.5 5L12.5 10L7.5 15" />
    </svg>
  );
}
