"use client";

import { useState, useTransition } from "react";
import { createCheckoutSessionAction } from "@/app/company/wallet/actions";
import { createSubscriptionCheckoutSessionAction } from "@/app/company/settings/subscriptionActions";

type LedgerEntry = { id: string; label: string; amount: number; balanceAfter: number; createdAt: string };
type PlanTier = "FREE" | "STANDARD" | "BUSINESS";

const PLAN_LABEL: Record<PlanTier, string> = {
  FREE: "無料",
  STANDARD: "スタンダード",
  BUSINESS: "ビジネス",
};

const PLAN_INFO: Record<PlanTier, { yen: number; quota: number; detail: string }> = {
  FREE: { yen: 0, quota: 0, detail: "過去データの閲覧は直近3ヶ月まで" },
  STANDARD: { yen: 3980, quota: 30, detail: "閲覧無制限・PDF発行 月30件まで無料" },
  BUSINESS: { yen: 7980, quota: 100, detail: "閲覧無制限・PDF発行 月100件まで無料" },
};

export function WalletView({
  teeBalance,
  yenPerUnit,
  stripeConfigured,
  planTier,
  ledgerEntries,
}: {
  teeBalance: number;
  yenPerUnit: number;
  stripeConfigured: boolean;
  planTier: PlanTier;
  ledgerEntries: LedgerEntry[];
}) {
  const [modal, setModal] = useState<"charge" | "plan" | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [teeAmount, setTeeAmount] = useState(100);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-3xl bg-primary text-primary-foreground shadow-lg">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/20" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-white/5" />

        <div className="relative px-8 pb-7 pt-8 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-accent font-serif-jp text-2xl font-bold text-primary shadow-md ring-4 ring-white/10">
            T
          </div>
          <p className="text-xs uppercase tracking-widest text-primary-foreground/60">現在の残高</p>
          <p className="mt-1 font-serif-jp text-5xl font-bold">
            {teeBalance}
            <span className="ml-2 text-xl font-normal text-primary-foreground/70">Tee</span>
          </p>
          <button
            type="button"
            onClick={() => setModal("charge")}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/35 bg-white/10 px-5 py-2 text-sm font-semibold"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
              <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            チャージする
          </button>
        </div>

        <div className="relative mx-8 border-t border-white/15" />

        <div className="relative flex items-center justify-between gap-4 px-8 pb-7 pt-5 text-left">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-primary-foreground/55">現在のプラン</p>
            <p className="mt-0.5 font-serif-jp text-base font-bold">{PLAN_LABEL[planTier]}プラン</p>
            <p className="mt-0.5 text-xs text-primary-foreground/70">{PLAN_INFO[planTier].detail}</p>
          </div>
          <button
            type="button"
            onClick={() => setModal("plan")}
            className="shrink-0 rounded-lg border border-white/35 px-4 py-2 text-xs font-semibold whitespace-nowrap"
          >
            プランを選ぶ
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-white/60">
        <button
          type="button"
          onClick={() => setUsageOpen((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <span className="font-serif-jp text-sm font-bold text-primary">Teeの使いみち</span>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            className={`h-4 w-4 text-muted transition-transform ${usageOpen ? "rotate-180" : ""}`}
          >
            <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {usageOpen ? (
          <div className="border-t border-border">
            <UsageRow
              label="公開募集の掲載"
              detail={
                <>
                  1枠 10 Tee
                  <br />
                  未使用分は返金
                </>
              }
              icon={
                <>
                  <path d="M3 8v4a1 1 0 001 1h1l7 3V4L5 7H4a1 1 0 00-1 1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  <path d="M15 7.5a3 3 0 010 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </>
              }
            />
            <UsageRow
              label="給与明細の発行"
              detail={
                <>
                  1件 1 Tee
                  <br />
                  無料枠・同月内は無料
                </>
              }
              icon={
                <>
                  <path d="M5 3h7l3 3v11a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  <path d="M7 9h6M7 12h6M7 15h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </>
              }
            />
            <UsageRow
              last
              label="請求書の発行"
              detail={
                <>
                  1件 1 Tee
                  <br />
                  無料枠・同月内は無料
                </>
              }
              icon={
                <>
                  <path d="M5 2.5h10v15l-2-1.3-1.5 1.3-1.5-1.3-1.5 1.3L7 16.2l-2 1.3v-15z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  <path d="M7.5 6.5h5M7.5 9.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </>
              }
            />
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="flex w-full items-center justify-between border-t border-border px-5 py-4 text-left"
        >
          <span className="font-serif-jp text-sm font-bold text-primary">購入履歴・利用履歴</span>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            className={`h-4 w-4 text-muted transition-transform ${historyOpen ? "rotate-180" : ""}`}
          >
            <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {historyOpen ? (
          <div className="border-t border-border px-5 pb-4 pt-1 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="py-1 font-normal">日時</th>
                  <th className="py-1 font-normal">内容</th>
                  <th className="py-1 font-normal">増減</th>
                  <th className="py-1 font-normal">残高</th>
                </tr>
              </thead>
              <tbody>
                {ledgerEntries.map((e) => (
                  <tr key={e.id} className="border-b border-border/60">
                    <td className="py-1">{new Date(e.createdAt).toLocaleString("ja-JP")}</td>
                    <td className="py-1">{e.label}</td>
                    <td className={`py-1 ${e.amount >= 0 ? "text-primary" : "text-red-600"}`}>
                      {e.amount >= 0 ? "+" : ""}
                      {e.amount}
                    </td>
                    <td className="py-1">{e.balanceAfter}</td>
                  </tr>
                ))}
                {ledgerEntries.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted">
                      履歴はありません。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {modal === "charge" ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-serif-jp text-lg font-bold text-primary">チャージするTee数</h3>
              <button type="button" onClick={() => setModal(null)} className="text-muted">
                ✕
              </button>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                value={teeAmount}
                onChange={(e) => setTeeAmount(Number(e.target.value))}
                className="w-32 rounded-lg border border-border px-3 py-2 text-sm"
              />
              <span className="text-sm text-muted">× {yenPerUnit}円</span>
            </div>
            <p className="mt-1 text-sm text-muted">{teeAmount * yenPerUnit}円</p>

            <button
              type="button"
              disabled={pending || !stripeConfigured || teeAmount < 1}
              onClick={() => startTransition(() => createCheckoutSessionAction(teeAmount))}
              className="mt-5 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              クレジットカードで購入（即時反映）
            </button>
            {!stripeConfigured ? (
              <p className="mt-2 text-xs text-red-600">Stripeが未設定のため、クレジットカード決済は利用できません。</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {modal === "plan" ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-serif-jp text-lg font-bold text-primary">プランを選ぶ</h3>
              <button type="button" onClick={() => setModal(null)} className="text-muted">
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-2.5">
              {(["FREE", "STANDARD", "BUSINESS"] as const).map((tier) => {
                const isCurrent = tier === planTier;
                return (
                  <div
                    key={tier}
                    className={`flex items-center justify-between gap-3 rounded-xl border p-4 ${
                      isCurrent ? "border-accent/70 bg-accent/10" : "border-border"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-semibold text-foreground">{PLAN_LABEL[tier]}プラン</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {tier === "FREE" ? "¥0 / 月" : `¥${PLAN_INFO[tier].yen.toLocaleString()} / 月`}
                      </p>
                      <p className="text-xs text-muted">{PLAN_INFO[tier].detail}</p>
                    </div>
                    {isCurrent ? (
                      <span className="shrink-0 rounded-full bg-accent/20 px-3 py-1 text-xs font-semibold text-accent">
                        現在のプラン
                      </span>
                    ) : tier === "FREE" ? null : (
                      <button
                        type="button"
                        disabled={pending || !stripeConfigured}
                        onClick={() => startTransition(() => createSubscriptionCheckoutSessionAction(tier))}
                        className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60 whitespace-nowrap"
                      >
                        このプランにする
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {!stripeConfigured ? (
              <p className="mt-3 text-xs text-red-600">Stripeが未設定のため、プランのアップグレードは利用できません。</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UsageRow({
  label,
  detail,
  icon,
  last,
}: {
  label: string;
  detail: React.ReactNode;
  icon: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-5 py-3.5 ${last ? "" : "border-b border-dashed border-border"}`}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center text-muted">
        <svg viewBox="0 0 20 20" fill="none" className="h-4.5 w-4.5">
          {icon}
        </svg>
      </span>
      <span className="text-sm text-foreground">{label}</span>
      <span className="ml-auto text-right text-xs text-muted">{detail}</span>
    </div>
  );
}
