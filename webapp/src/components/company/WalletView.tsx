"use client";

import { useState, useTransition } from "react";
import { createCheckoutSessionAction } from "@/app/company/wallet/actions";

type LedgerEntry = { id: string; label: string; amount: number; balanceAfter: number; createdAt: string };

export function WalletView({
  teeBalance,
  yenPerUnit,
  stripeConfigured,
  ledgerEntries,
}: {
  teeBalance: number;
  yenPerUnit: number;
  stripeConfigured: boolean;
  ledgerEntries: LedgerEntry[];
}) {
  const [tab, setTab] = useState<"purchase" | "history">("purchase");
  const [teeAmount, setTeeAmount] = useState(100);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-3xl bg-primary p-8 text-center text-primary-foreground shadow-lg">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/20" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-white/5" />
        <div className="relative">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-accent font-serif-jp text-2xl font-bold text-primary shadow-md ring-4 ring-white/10">
            T
          </div>
          <p className="text-xs uppercase tracking-widest text-primary-foreground/60">現在の残高</p>
          <p className="mt-1 font-serif-jp text-5xl font-bold">
            {teeBalance}
            <span className="ml-2 text-xl font-normal text-primary-foreground/70">Tee</span>
          </p>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted">Teeの使いみち</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-white/60 p-4">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-accent/20 text-accent">
              <svg viewBox="0 0 20 20" fill="none" className="h-4.5 w-4.5">
                <path d="M3 8v4a1 1 0 001 1h1l7 3V4L5 7H4a1 1 0 00-1 1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M15 7.5a3 3 0 010 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-foreground">公開募集の掲載</p>
            <p className="mt-1 text-xs text-muted">1枠 10 Tee</p>
            <p className="text-xs text-muted">未使用分は返金</p>
          </div>
          <div className="rounded-2xl border border-border bg-white/60 p-4">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <svg viewBox="0 0 20 20" fill="none" className="h-4.5 w-4.5">
                <path d="M5 3h7l3 3v11a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M7 9h6M7 12h6M7 15h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-foreground">給与明細の発行</p>
            <p className="mt-1 text-xs text-muted">1件 1 Tee</p>
            <p className="text-xs text-muted">同月内の再発行は無料</p>
          </div>
          <div className="rounded-2xl border border-border bg-white/60 p-4">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <svg viewBox="0 0 20 20" fill="none" className="h-4.5 w-4.5">
                <path d="M5 2.5h10v15l-2-1.3-1.5 1.3-1.5-1.3-1.5 1.3L7 16.2l-2 1.3v-15z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M7.5 6.5h5M7.5 9.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-foreground">請求書の発行</p>
            <p className="mt-1 text-xs text-muted">1件 1 Tee</p>
            <p className="text-xs text-muted">同月内の再発行は無料</p>
          </div>
        </div>
      </section>

      <div className="flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setTab("purchase")}
          className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab === "purchase" ? "border-accent text-primary" : "border-transparent text-muted"}`}
        >
          チャージ
        </button>
        <button
          type="button"
          onClick={() => setTab("history")}
          className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab === "history" ? "border-accent text-primary" : "border-transparent text-muted"}`}
        >
          購入履歴・利用履歴
        </button>
      </div>

      {tab === "purchase" ? (
        <div className="flex flex-col gap-6">
          <section className="rounded-2xl border border-border bg-white/60 p-6">
            <h2 className="mb-3 font-serif-jp text-lg font-bold text-primary">チャージするTee数</h2>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                value={teeAmount}
                onChange={(e) => setTeeAmount(Number(e.target.value))}
                className="w-32 rounded-lg border border-border px-3 py-2 text-sm"
              />
              <span className="text-sm text-muted">
                × {yenPerUnit}円 = {teeAmount * yenPerUnit}円
              </span>
            </div>

            <div className="mt-6 flex flex-col gap-3">
              <div>
                <button
                  type="button"
                  disabled={pending || !stripeConfigured || teeAmount < 1}
                  onClick={() => startTransition(() => createCheckoutSessionAction(teeAmount))}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  クレジットカードで購入（即時反映）
                </button>
                {!stripeConfigured ? (
                  <p className="mt-1 text-xs text-red-600">
                    Stripeが未設定のため、クレジットカード決済は利用できません。
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : (
        <section className="rounded-2xl border border-border bg-white/60 p-6">
          <h2 className="mb-3 font-serif-jp text-lg font-bold text-primary">履歴</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-1">日時</th>
                <th className="py-1">内容</th>
                <th className="py-1">増減</th>
                <th className="py-1">残高</th>
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
        </section>
      )}
    </div>
  );
}
