import Link from "next/link";
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

// このページは唯一「未ログインの訪問者に実コンテンツを返す」公開ページ
// のため、Next.jsのビルド時プリレンダー判定に賭けず明示的に動的指定する
// （他の画面はログイン必須でauth()のredirectにしかならずこの問題が
// 表面化しなかった）。
export const dynamic = "force-dynamic";

const PAIN_POINTS = [
  "紙やExcelでのシフト管理が属人化していて、担当者しか把握できない",
  "タイムカードの集計や給与計算に毎月時間がかかっている",
  "給与明細や請求書の発行・配布が面倒",
  "派遣スタッフや複数の取引先とのやりとりが煩雑",
];

const FEATURES: { icon: ReactNode; title: string; description: string; screenshot?: string }[] = [
  {
    icon: <IconCalendar />,
    title: "シフト管理",
    description: "カレンダーでシフトを作成・調整。欠員や未確定のシフトもひと目で把握できます。",
  },
  {
    icon: <IconClock />,
    title: "タイムカード・業務報告",
    description: "スタッフはスマホで出退勤を記録し、業務報告を提出。企業側はそのまま確認・承認するだけ。",
  },
  {
    icon: <IconYen />,
    title: "給与計算・給与明細発行",
    description: "打刻と契約内容から給与を自動で計算。明細はそのままPDFで発行できます。",
    screenshot: "/lp/payroll.png",
  },
  {
    icon: <IconDocument />,
    title: "請求書発行",
    description: "取引先ごとの実績から請求書を自動で作成し、PDFで発行できます。",
  },
  {
    icon: <IconLink />,
    title: "派遣会社連携",
    description: "自社・取引先・派遣スタッフの関係をまとめて管理。誰がどこで働いているか迷いません。",
  },
  {
    icon: <IconGift />,
    title: "スタッフ向けポイント制度",
    description: "業務報告の承認でポイントが貯まり、販促品と交換できる仕組み。スタッフの定着にもつながります。",
    screenshot: "/lp/points.png",
  },
];

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

export default async function LandingPage() {
  const session = await auth();
  if (session?.user?.id) {
    redirect("/home");
  }

  return (
    <main className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2 font-serif-jp text-xl font-bold text-primary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" className="h-8 w-8 rounded-lg" />
          TeeRA
        </div>
        <Link href="/login" className="text-sm font-semibold text-primary hover:underline">
          ログイン
        </Link>
      </header>

      {/* Hero */}
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-6 py-16 text-center sm:py-20">
        <h1 className="font-serif-jp text-3xl font-bold leading-snug text-primary sm:text-4xl">
          シフト管理から給与計算まで、
          <br />
          ひとつのアプリで。
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted sm:text-base">
          シフト作成、タイムカード、業務報告、給与計算、請求書発行までをひとつにまとめた、
          企業とスタッフのためのシフト管理プラットフォームです。基本機能は無料でご利用いただけます。
        </p>
        <Link
          href="/register"
          className="rounded-lg bg-primary px-8 py-3 text-base font-semibold text-primary-foreground shadow-md"
        >
          無料で始める
        </Link>
        <div className="mt-4 w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-white shadow-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/lp/calendar.png" alt="シフトカレンダーの画面" className="w-full" />
        </div>
      </section>

      {/* Pain points */}
      <section className="bg-primary/5 px-6 py-14">
        <div className="mx-auto w-full max-w-3xl">
          <h2 className="mb-6 text-center font-serif-jp text-xl font-bold text-primary">
            こんな悩み、ありませんか？
          </h2>
          <ul className="flex flex-col gap-3">
            {PAIN_POINTS.map((point) => (
              <li
                key={point}
                className="flex items-start gap-3 rounded-xl border border-border bg-white/70 px-4 py-3 text-sm"
              >
                <span className="mt-0.5 text-accent">✓</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto w-full max-w-5xl px-6 py-16">
        <h2 className="mb-10 text-center font-serif-jp text-xl font-bold text-primary">できること</h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex flex-col rounded-2xl border border-border bg-white/60 p-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                {f.icon}
              </div>
              <h3 className="mb-1.5 font-semibold text-foreground">{f.title}</h3>
              <p className="text-sm leading-relaxed text-muted">{f.description}</p>
              {f.screenshot ? (
                <div className="mt-4 overflow-hidden rounded-lg border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.screenshot} alt="" className="w-full" />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {/* Steps */}
      <section className="bg-primary/5 px-6 py-16">
        <div className="mx-auto w-full max-w-3xl">
          <h2 className="mb-10 text-center font-serif-jp text-xl font-bold text-primary">はじめかた</h2>
          <div className="flex flex-col gap-6 sm:flex-row sm:gap-5">
            {STEPS.map((step, i) => (
              <div key={step.title} className="flex flex-1 flex-col items-center gap-2 text-center">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary font-serif-jp text-sm font-bold text-primary-foreground">
                  {i + 1}
                </div>
                <h3 className="font-semibold text-foreground">{step.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="mx-auto w-full max-w-5xl px-6 py-16">
        <h2 className="mb-2 text-center font-serif-jp text-xl font-bold text-primary">料金プラン</h2>
        <p className="mb-10 text-center text-sm text-muted">基本機能は無料プランのままずっとご利用いただけます。</p>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`flex flex-col rounded-2xl border p-6 ${
                plan.highlight ? "border-accent bg-white shadow-md" : "border-border bg-white/60"
              }`}
            >
              <div className="mb-2 h-5">
                {plan.highlight ? (
                  <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold text-primary">
                    人気
                  </span>
                ) : null}
              </div>
              <h3 className="font-serif-jp text-lg font-bold text-primary">{plan.name}</h3>
              <p className="mb-4 mt-1 text-2xl font-bold text-foreground">{plan.price}</p>
              <ul className="flex flex-1 flex-col gap-2 text-sm text-muted">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span className="mt-0.5 text-accent">✓</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Footer CTA */}
      <section className="bg-primary px-6 py-16 text-center text-primary-foreground">
        <h2 className="mb-4 font-serif-jp text-2xl font-bold">まずは無料で、始めてみませんか？</h2>
        <Link
          href="/register"
          className="inline-block rounded-lg bg-accent px-8 py-3 text-base font-semibold text-primary shadow-md"
        >
          無料で始める
        </Link>
      </section>

      <footer className="px-6 py-8 text-center text-xs text-muted">
        <div className="mb-2 font-serif-jp text-base font-bold text-primary">TeeRA</div>
        <Link href="/login" className="hover:underline">
          ログイン
        </Link>
      </footer>
    </main>
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
