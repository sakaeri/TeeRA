"use client";

import { useEffect, useState, type ReactNode } from "react";

const OVERVIEW_TEXT =
  "紙やExcelでのシフト管理が属人化していて担当者しか把握できない、タイムカードの集計や給与計算に毎月時間がかかる、" +
  "給与明細や請求書の発行・配布が面倒、派遣スタッフや複数の取引先とのやりとりが煩雑——そんな悩みをまとめて解決するのがTeeRAです。" +
  "基本機能は無料でご利用いただけます。";

const STEPS = [
  { title: "無料登録", description: "会社情報を入力するだけ、1分で完了します。" },
  { title: "スタッフを招待", description: "招待リンクを送るだけで、スタッフがアプリに参加できます。" },
  { title: "シフトを作成して運用開始", description: "カレンダーでシフトを組めば、その日から使い始められます。" },
];

const PLANS: {
  name: string;
  price: string;
  highlight?: boolean;
  features: string[];
}[] = [
  {
    name: "無料プラン",
    price: "¥0 / 月",
    features: [
      "シフト管理・タイムカード・業務報告",
      "給与計算・スタッフ管理",
      "スタッフ向けポイント制度",
      "閲覧できる履歴は直近3ヶ月まで",
      "給与明細・請求書のPDF発行は1枚ごとの従量課金",
    ],
  },
  {
    name: "スタンダード",
    price: "¥3,980 / 月",
    highlight: true,
    features: [
      "無料プランの内容をすべて含む",
      "月30枚までPDF発行が月額に含まれる",
      "過去の履歴を制限なく閲覧可能",
    ],
  },
  {
    name: "ビジネス",
    price: "¥7,980 / 月",
    features: [
      "無料プランの内容をすべて含む",
      "月100枚までPDF発行が月額に含まれる",
      "過去の履歴を制限なく閲覧可能",
    ],
  },
];

const FEATURES: { key: string; icon: ReactNode; title: string; description: string; screenshot?: string }[] = [
  {
    key: "shift",
    icon: <IconCalendar />,
    title: "シフト管理",
    description: "カレンダーでシフトを作成・調整。欠員や未確定のシフトもひと目で把握できます。",
  },
  {
    key: "timecard",
    icon: <IconClock />,
    title: "タイムカード・業務報告",
    description: "スタッフはスマホで出退勤を記録し、業務報告を提出。企業側はそのまま確認・承認するだけ。",
  },
  {
    key: "payroll",
    icon: <IconYen />,
    title: "給与計算・給与明細発行",
    description: "打刻と契約内容から給与を自動で計算。明細はそのままPDFで発行できます。",
    screenshot: "/lp/payroll.png",
  },
  {
    key: "invoice",
    icon: <IconDocument />,
    title: "請求書発行",
    description: "取引先ごとの実績から請求書を自動で作成し、PDFで発行できます。",
  },
  {
    key: "agency",
    icon: <IconLink />,
    title: "派遣会社連携",
    description: "自社・取引先・派遣スタッフの関係をまとめて管理。誰がどこで働いているか迷いません。",
  },
  {
    key: "points",
    icon: <IconGift />,
    title: "スタッフ向けポイント制度",
    description: "業務報告の承認でポイントが貯まり、販促品と交換できる仕組み。スタッフの定着にもつながります。",
    screenshot: "/lp/points.png",
  },
];

type PopupKey = "overview" | "steps" | "pricing" | `feature-${string}`;

// ポップアップを開く時にhistoryへダミーのエントリを積み、戻るボタンで
// ページごと離脱せずポップアップだけ閉じるようにする。✕ボタンでの
// クローズもhistory.back()に統一し、積んだエントリが残り続けない
// ようにする。
function usePopup() {
  const [openKey, setOpenKey] = useState<PopupKey | null>(null);

  useEffect(() => {
    function onPopState(e: PopStateEvent) {
      const key = (e.state as { lpPopup?: PopupKey } | null)?.lpPopup ?? null;
      setOpenKey(key);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function open(key: PopupKey) {
    window.history.pushState({ lpPopup: key }, "");
    setOpenKey(key);
  }
  function close() {
    if ((window.history.state as { lpPopup?: PopupKey } | null)?.lpPopup) {
      window.history.back();
    } else {
      setOpenKey(null);
    }
  }
  return { openKey, open, close };
}

function PopupShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">{title}</h3>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-muted">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function LandingNav() {
  const { openKey, open, close } = usePopup();
  const activeFeature = FEATURES.find((f) => openKey === `feature-${f.key}`);

  return (
    <section className="mx-auto w-full max-w-3xl px-6 pb-16">
      <div className="flex flex-wrap justify-center gap-3">
        <NavButton onClick={() => open("overview")}>TeeRAとは？</NavButton>
        <NavButton onClick={() => open("steps")}>はじめかた</NavButton>
        <NavButton onClick={() => open("pricing")}>料金プラン</NavButton>
      </div>

      <h2 className="mb-4 mt-10 text-center font-serif-jp text-lg font-bold text-primary">できること</h2>
      <div className="grid grid-cols-3 gap-3">
        {FEATURES.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => open(`feature-${f.key}`)}
            className="flex flex-col items-center gap-2 rounded-xl border border-border bg-white/60 p-3 text-center"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              {f.icon}
            </span>
            <span className="text-xs font-semibold leading-tight text-foreground">{f.title}</span>
          </button>
        ))}
      </div>

      {openKey === "overview" ? (
        <PopupShell title="TeeRAとは？" onClose={close}>
          <p className="text-sm leading-relaxed text-muted">{OVERVIEW_TEXT}</p>
        </PopupShell>
      ) : null}

      {openKey === "steps" ? (
        <PopupShell title="はじめかた" onClose={close}>
          <div className="flex flex-col gap-5">
            {STEPS.map((step, i) => (
              <div key={step.title} className="flex items-start gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary font-serif-jp text-xs font-bold text-primary-foreground">
                  {i + 1}
                </div>
                <div>
                  <h4 className="font-semibold text-foreground">{step.title}</h4>
                  <p className="text-sm leading-relaxed text-muted">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </PopupShell>
      ) : null}

      {openKey === "pricing" ? (
        <PopupShell title="料金プラン" onClose={close}>
          <p className="mb-4 text-sm text-muted">基本機能は無料プランのままずっとご利用いただけます。</p>
          <div className="flex flex-col gap-4">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-xl border p-4 ${
                  plan.highlight ? "border-accent bg-white shadow-sm" : "border-border bg-white/60"
                }`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <h4 className="font-serif-jp text-base font-bold text-primary">{plan.name}</h4>
                  {plan.highlight ? (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-primary">
                      人気
                    </span>
                  ) : null}
                </div>
                <p className="mb-2 text-xl font-bold text-foreground">{plan.price}</p>
                <ul className="flex flex-col gap-1.5 text-xs text-muted">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-1.5">
                      <span className="mt-0.5 text-accent">✓</span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </PopupShell>
      ) : null}

      {activeFeature ? (
        <PopupShell title={activeFeature.title} onClose={close}>
          <p className="text-sm leading-relaxed text-muted">{activeFeature.description}</p>
          {activeFeature.screenshot ? (
            <div className="mt-4 overflow-hidden rounded-lg border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={activeFeature.screenshot} alt="" className="w-full" />
            </div>
          ) : null}
        </PopupShell>
      ) : null}
    </section>
  );
}

function NavButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-primary px-5 py-2.5 text-sm font-semibold text-primary"
    >
      {children}
    </button>
  );
}

function IconCalendar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-5 w-5">
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-5 w-5">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconYen() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-5 w-5">
      <path d="M7 5l5 7 5-7M12 12v7M9 14h6M9 17h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconDocument() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-5 w-5">
      <path d="M6.5 3.5h7l4 4v13h-11z" strokeLinejoin="round" />
      <path d="M13.5 3.5v4h4M9 12.5h6M9 15.5h6M9 18.5h3" strokeLinecap="round" />
    </svg>
  );
}

function IconLink() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-5 w-5">
      <circle cx="7" cy="7" r="3" />
      <circle cx="17" cy="7" r="3" />
      <circle cx="12" cy="18" r="3" />
      <path d="M8.8 9.2L10.5 15.5M15.2 9.2L13.5 15.5" strokeLinecap="round" />
    </svg>
  );
}

function IconGift() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-5 w-5">
      <rect x="3.5" y="9.5" width="17" height="4" rx="1" />
      <rect x="4.5" y="13.5" width="15" height="7" rx="1" />
      <path d="M12 9.5v11M12 9.5c-1.2-3-3.5-4-4.5-3s0 3.3 4.5 3zM12 9.5c1.2-3 3.5-4 4.5-3s0 3.3-4.5 3z" strokeLinejoin="round" />
    </svg>
  );
}
