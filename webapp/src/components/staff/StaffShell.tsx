"use client";

import { useState } from "react";
import { Toaster } from "@/components/Toast";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { loadContractConsentAction } from "@/app/staff/contracts/actions";
import { ContractConsentWizard, type ContractConsentData } from "@/components/staff/ContractConsentWizard";
import { logoutAction } from "@/app/actions/auth";
import { useClickOutside } from "@/lib/useClickOutside";
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";

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

function BellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M10 20.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
  { href: "/staff", label: "カレンダー", Icon: CalendarIcon },
  { href: "/staff/recruitments", label: "募集", Icon: MegaphoneIcon },
  { href: "/staff/timecard", label: "タイムカード", Icon: ClockIcon },
  { href: "/staff/notices", label: "お知らせ", Icon: BellIcon },
  { href: "/staff/contracts", label: "設定", Icon: GearIcon },
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
  openRecruitmentCount,
  unsubmittedReportCount,
  contractSettingsBadgeCount,
  unreadNoticeCount,
  pendingContractCompanies,
  children,
}: {
  userName: string;
  userEmail: string;
  pointsBalance: number;
  hasMultipleCompanies: boolean;
  showCompanyScreenLink: boolean;
  openRecruitmentCount: number;
  unsubmittedReportCount: number;
  contractSettingsBadgeCount: number;
  unreadNoticeCount: number;
  // 確認待ち（PENDING_CONSENT）の契約書がある会社。ある間は、契約書の画面以外では
  // 閉じられないポップアップを出して、確認・同意を先に済ませてもらう。
  pendingContractCompanies: { id: string; name: string }[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useClickOutside<HTMLDivElement>(profileOpen, () => setProfileOpen(false));
  const initial = userName.slice(0, 1);

  const showContractPopup = pendingContractCompanies.length > 0 && !pathname.startsWith("/staff/contracts");

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="print-hide flex flex-wrap items-center justify-between gap-3 border-b-2 border-accent bg-primary px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top)*1.5)] text-primary-foreground">
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
              <div className="absolute right-0 z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl bg-white p-4 text-foreground shadow-lg">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary font-serif-jp font-bold text-primary-foreground">
                      {initial}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold">{userName}</p>
                      <p className="break-all text-xs text-muted">{userEmail}</p>
                    </div>
                  </div>
                  <Link
                    href="/account"
                    aria-label="アカウント設定"
                    title="アカウント設定"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-background hover:text-primary"
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
                </div>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <Link
                    href="/staff/payslips"
                    onClick={() => setProfileOpen(false)}
                    className="rounded-lg border border-border px-3 py-2 text-center text-sm text-foreground hover:border-primary"
                  >
                    給料明細
                  </Link>
                  <Link
                    href="/staff/howto"
                    onClick={() => setProfileOpen(false)}
                    className="rounded-lg border border-border px-3 py-2 text-center text-sm text-foreground hover:border-primary"
                  >
                    使い方
                  </Link>
                </div>
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

      <PushNotificationPrompt />

      <nav className="print-hide flex items-stretch justify-around border-b border-border/60 bg-white/40 px-1 py-1.5 sm:justify-start sm:gap-1 sm:px-4">
        {NAV.map((item) => {
          const active =
            pathname === item.href || (item.href !== "/staff" && pathname.startsWith(`${item.href}/`));
          const badgeCount =
            item.href === "/staff/recruitments"
              ? openRecruitmentCount
              : item.href === "/staff/timecard"
                ? unsubmittedReportCount
                : item.href === "/staff/notices"
                  ? unreadNoticeCount
                  : item.href === "/staff/contracts"
                    ? contractSettingsBadgeCount
                    : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 sm:flex-none sm:px-3"
            >
              <span
                className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
                  active ? "bg-primary text-primary-foreground" : "text-muted"
                }`}
              >
                <item.Icon className="h-5 w-5 shrink-0" />
                {badgeCount > 0 ? (
                  <span className="absolute -right-1 -top-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-red-600 px-0.5 text-[9px] font-bold leading-none text-white">
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                ) : null}
              </span>
              <span className={`text-[11px] font-medium ${active ? "text-primary" : "text-muted"}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-1 flex-col bg-background print:bg-white">{children}</div>
      {showContractPopup ? <PendingContractPopup companies={pendingContractCompanies} /> : null}
      <Toaster />
    </div>
  );
}

// 確認待ちの契約書があるときのポップアップ。✕では閉じられない。「契約書を確認する」で
// その場で契約書を開き、内容 → 身分証 → 振込先 → 署名まで済ませる（設定の画面には移らない）
function PendingContractPopup({ companies }: { companies: { id: string; name: string }[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wizard, setWizard] = useState<ContractConsentData | null>(null);

  async function open(companyId: string) {
    setError(null);
    setLoading(companyId);
    try {
      const data = await loadContractConsentAction(companyId);
      if (data && data.contracts.length > 0) setWizard(data);
      else router.refresh();
    } catch {
      setError("契約書を開けませんでした。もう一度お試しください。");
    } finally {
      setLoading(null);
    }
  }

  if (wizard) {
    return (
      <ContractConsentWizard
        data={wizard}
        onClose={() => setWizard(null)}
        onFinished={() => {
          setWizard(null);
          router.refresh();
        }}
      />
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="新しい契約書が届いています"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">
        <p className="font-serif-jp text-lg font-bold text-primary">新しい契約書が届いています</p>
        <p className="mt-2 text-sm text-foreground/80">
          契約書の確認・同意が終わるまで、ほかの画面は使えません。内容を確認して同意してください。
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {companies.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={loading !== null}
              onClick={() => open(c.id)}
              className="rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {loading === c.id
                ? "開いています…"
                : companies.length > 1
                  ? `${c.name}の契約書を確認する`
                  : "契約書を確認する"}
            </button>
          ))}
        </div>
        {companies.length === 1 ? <p className="mt-2 text-center text-xs text-muted">{companies[0].name}</p> : null}
        {error ? <p className="mt-2 text-center text-xs text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}
