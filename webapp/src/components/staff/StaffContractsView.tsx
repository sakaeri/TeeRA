"use client";

import { useTransition } from "react";
import { startContractAction } from "@/app/staff/contracts/actions";

const WAGE_TYPE_LABEL: Record<string, string> = { HOURLY: "時給", DAILY: "日給", MONTHLY: "月給" };
const STATUS_LABEL: Record<string, string> = {
  PENDING_CONSENT: "承諾待ち",
  ACTIVE: "契約中",
  ENDED: "終了",
};

export function StaffContractsView({
  myContracts,
  availableTemplates,
}: {
  myContracts: { id: string; title: string; status: string; wageAmountSnapshot: number; wageType: string }[];
  availableTemplates: { id: string; title: string; wageType: string; wageAmount: number }[];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <h2 className="mb-4 font-serif-jp text-lg font-bold text-primary">契約中の雇用契約書</h2>
        {myContracts.length === 0 ? (
          <p className="text-sm text-muted">契約はまだありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {myContracts.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-lg border border-border/60 p-3 text-sm">
                <span>{c.title}</span>
                <span className="text-muted">
                  {WAGE_TYPE_LABEL[c.wageType]} {c.wageAmountSnapshot}円 ／ {STATUS_LABEL[c.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <h2 className="mb-4 font-serif-jp text-lg font-bold text-primary">契約を結ぶ</h2>
        {availableTemplates.length === 0 ? (
          <p className="text-sm text-muted">結べる契約書テンプレートはありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {availableTemplates.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-lg border border-border/60 p-3 text-sm">
                <span>
                  {t.title} — {WAGE_TYPE_LABEL[t.wageType]} {t.wageAmount}円
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => startContractAction(t.id))}
                  className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                >
                  契約を結ぶ
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
