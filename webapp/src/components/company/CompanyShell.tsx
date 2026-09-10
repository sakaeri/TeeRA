"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import { useClickOutside } from "@/lib/useClickOutside";

const NAV = [
  { href: "/company", label: "ダッシュボード" },
  { href: "/company/calendar", label: "シフトカレンダー" },
  { href: "/company/roster", label: "スタッフ名簿" },
  { href: "/company/payroll", label: "給料明細/請求書", matchPrefixes: ["/company/payroll", "/company/invoices"] },
  { href: "/company/settings", label: "設定" },
];

function todayLabel() {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function CompanyShell({
  companyName,
  userName,
  userEmail,
  roleLabel,
  teeBalance,
  hasMultipleCompanies,
  showStaffScreenLink,
  children,
}: {
  companyName: string;
  userName: string;
  userEmail: string;
  roleLabel: string;
  teeBalance: number;
  hasMultipleCompanies: boolean;
  showStaffScreenLink: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useClickOutside<HTMLDivElement>(profileOpen, () => setProfileOpen(false));
  const initial = userName.slice(0, 1);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between gap-6 border-b-2 border-accent bg-primary px-6 py-3 text-primary-foreground">
        <div className="flex items-center gap-4">
          <div className="font-serif-jp text-lg font-bold tracking-wide">TeeRA</div>
          <span className="text-xs opacity-70">{todayLabel()}</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs">
            {companyName} ・ {roleLabel}
          </span>
          <Link
            href="/company/wallet"
            className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-primary"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
              T
            </span>
            {teeBalance} Tee
          </Link>
          <div className="relative" ref={profileRef}>
            <button
              type="button"
              aria-label="プロフィールメニュー"
              onClick={() => setProfileOpen((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 font-serif-jp font-bold text-primary"
            >
              {initial}
            </button>
            {profileOpen ? (
              <div className="absolute right-0 z-30 mt-2 w-72 rounded-xl bg-white p-4 text-foreground shadow-lg">
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary font-serif-jp font-bold text-primary-foreground">
                    {initial}
                  </span>
                  <div>
                    <p className="font-semibold">{userName}</p>
                    <p className="text-xs text-muted">{userEmail}</p>
                  </div>
                </div>
                <Link
                  href="/account"
                  className="mb-3 block rounded-lg border border-border px-4 py-2 text-center text-sm text-foreground hover:border-primary"
                >
                  アカウント設定
                </Link>
                {showStaffScreenLink ? (
                  <Link
                    href="/staff"
                    className="mb-3 block rounded-lg border border-border px-4 py-2 text-center text-sm text-foreground hover:border-primary"
                  >
                    スタッフ画面へ
                  </Link>
                ) : null}
                {hasMultipleCompanies ? (
                  <Link
                    href="/home?switch=1"
                    className="mb-3 block rounded-lg border border-border px-4 py-2 text-center text-sm text-foreground hover:border-primary"
                  >
                    会社を切り替える
                  </Link>
                ) : null}
                <form action={logoutAction}>
                  <button
                    type="submit"
                    className="w-full rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700"
                  >
                    ログアウト
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <nav className="w-52 shrink-0 bg-primary py-6 text-primary-foreground">
          {NAV.map((item) => {
            const active = item.matchPrefixes
              ? item.matchPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
              : pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-6 py-3 text-sm ${
                  active ? "bg-white/10 font-semibold" : "opacity-80 hover:opacity-100"
                }`}
              >
                {active ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : <span className="w-1.5" />}
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex-1 bg-background">{children}</div>
      </div>
    </div>
  );
}
