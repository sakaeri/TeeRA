"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import { useClickOutside } from "@/lib/useClickOutside";

// 会社側の「＋」メニュー内のアイコン(CalendarView.tsx)と同じviewBox 24・
// strokeWidth 1.8の線画スタイルに揃えたナビゲーションアイコン。
function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 9h18" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MegaphoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M3 10v4a1 1 0 001 1h2l3 4V5L6 9H4a1 1 0 00-1 1z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M11 6.5l7-3v17l-7-3" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M7 15v2.5a1.5 1.5 0 003 0V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 3v2.2M12 18.8V21M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3 12h2.2M18.8 12H21M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

const NAV = [
  { href: "/staff", label: "シフトカレンダー", Icon: CalendarIcon },
  { href: "/staff/recruitments", label: "募集一覧", Icon: MegaphoneIcon },
  { href: "/staff/timecard", label: "タイムカード", Icon: ClockIcon },
  { href: "/staff/contracts", label: "所属先設定", Icon: GearIcon },
];

function todayLabel() {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function StaffShell({
  userName,
  userEmail,
  pointsBalance,
  hasMultipleCompanies,
  showCompanyScreenLink,
  children,
}: {
  userName: string;
  userEmail: string;
  pointsBalance: number;
  hasMultipleCompanies: boolean;
  showCompanyScreenLink: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useClickOutside<HTMLDivElement>(profileOpen, () => setProfileOpen(false));
  const initial = userName.slice(0, 1);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-accent bg-primary px-4 py-3 text-primary-foreground">
        <div className="flex items-center gap-2">
          <div className="font-serif-jp text-lg font-bold tracking-wide">TeeRA</div>
          <span className="text-xs opacity-70">{todayLabel()}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/staff/points"
            className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-primary"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
              P
            </span>
            {pointsBalance} ポイント
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
              <div className="absolute right-0 z-30 mt-2 w-64 rounded-xl bg-white p-4 text-foreground shadow-lg">
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
                {showCompanyScreenLink ? (
                  <Link
                    href="/company"
                    className="mb-3 block rounded-lg border border-border px-4 py-2 text-center text-sm text-foreground hover:border-primary"
                  >
                    会社画面へ
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
                  <button type="submit" className="w-full rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
                    ログアウト
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2 px-4 py-3">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-white/60 text-foreground"
              }`}
            >
              <item.Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1 bg-background">{children}</div>
    </div>
  );
}
