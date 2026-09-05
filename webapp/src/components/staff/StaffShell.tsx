"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";

const NAV = [
  { href: "/staff", label: "シフトカレンダー", icon: "🗓" },
  { href: "/staff/recruitments", label: "募集一覧", icon: "📣" },
  { href: "/staff/timecard", label: "タイムカード", icon: "⏱" },
  { href: "/staff/contracts", label: "所属先設定", icon: "⚙" },
];

function todayLabel() {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function StaffShell({
  companyName,
  userName,
  userEmail,
  pointsBalance,
  hasMultipleCompanies,
  children,
}: {
  companyName: string;
  userName: string;
  userEmail: string;
  pointsBalance: number;
  hasMultipleCompanies: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [profileOpen, setProfileOpen] = useState(false);
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
          <div className="relative">
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
                <div className="mb-3 rounded-lg bg-background px-3 py-2 text-xs">{companyName}</div>
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
              <span>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1 bg-background">{children}</div>
    </div>
  );
}
