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
      <section className="rounded-2xl border-2 border-primary bg-white/60 p-6 text-center">
        <p className="text-sm text-muted">現在の残高</p>
        <p className="font-serif-jp text-3xl font-bold text-primary">{teeBalance} Tee</p>
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
