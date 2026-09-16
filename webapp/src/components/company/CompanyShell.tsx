"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import { useClickOutside } from "@/lib/useClickOutside";

const NAV = [
  { href: "/company", label: "ダッシュボード", mobileLabel: "ホーム" },
  { href: "/company/calendar", label: "シフトカレンダー", mobileLabel: "カレンダー" },
  { href: "/company/roster", label: "スタッフ名簿", mobileLabel: "名簿" },
  {
    href: "/company/payroll",
    label: "給料明細/請求書",
    mobileLabel: "給与/請求",
    matchPrefixes: ["/company/payroll", "/company/invoices"],
  },
  { href: "/company/settings", label: "設定", mobileLabel: "設定" },
];

function isNavItemActive(item: (typeof NAV)[number], pathname: string) {
  return item.matchPrefixes
    ? item.matchPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
    : pathname === item.href;
}

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
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-accent bg-primary px-4 py-3 text-primary-foreground sm:gap-6 sm:px-6">
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="font-serif-jp text-lg font-bold tracking-wide">TeeRA</div>
          <span className="hidden text-xs opacity-70 sm:inline">{todayLabel()}</span>
        </div>
        <div className="flex items-center gap-2 text-sm sm:gap-3">
          <span className="inline-block max-w-[32vw] truncate rounded-full bg-white/10 px-3 py-1.5 text-xs sm:max-w-[40vw]">
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
          <Link
            href="/account"
            aria-label="アカウント設定"
            title="アカウント設定"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/90 text-primary hover:bg-white"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path
                d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
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
              <div className="absolute right-0 z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl bg-white p-4 text-foreground shadow-lg sm:w-72">
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary font-serif-jp font-bold text-primary-foreground">
                    {initial}
                  </span>
                  <div>
                    <p className="font-semibold">{userName}</p>
                    <p className="text-xs text-muted">{userEmail}</p>
                  </div>
                </div>
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

      {/*
        デスクトップ用サイドバーをDOM上ではモバイル用タブバーより先に置く
        （見た目の並び順はorderユーティリティで制御）。テキストベースの
        既存スモークテスト（page.click("text=設定")等）はDOM順で最初に
        一致した要素を対象にするため、先に書かれた方が可視状態のサイド
        バー側になり、既存テストの挙動を変えずに済む。
      */}
      <div className="order-2 flex flex-1 flex-col sm:flex-row">
        <nav className="hidden w-52 shrink-0 bg-primary py-6 text-primary-foreground sm:block">
          {NAV.map((item) => {
            const active = isNavItemActive(item, pathname);
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
        <div className="flex flex-1 flex-col bg-background">{children}</div>
      </div>

      <nav className="order-1 flex items-stretch justify-around border-b border-accent/60 bg-primary text-primary-foreground sm:hidden">
        {NAV.map((item) => {
          const active = isNavItemActive(item, pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 px-1 py-2.5 text-center text-[11px] font-medium ${
                active ? "border-b-2 border-accent bg-white/10" : "opacity-75"
              }`}
            >
              {item.mobileLabel}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
