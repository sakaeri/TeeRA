"use client";

import { useTransition } from "react";
import { PdfLink } from "@/components/PdfLink";
import { consentToElectronicPayslipAction } from "@/app/staff/actions";

type Company = {
  companyId: string;
  companyName: string;
  consented: boolean;
  slips: { id: string; issueId: string; targetMonth: string; issuedAt: string; net: number; revised: boolean; isContractor: boolean }[];
};

// 会社が発行した給料明細（業務委託は支払明細）。電子で受け取ることに同意するまでは中身を見せない
export function StaffPayslipsView({ companies }: { companies: Company[] }) {
  const [pending, startTransition] = useTransition();
  if (companies.length === 0) {
    return <p className="text-sm text-muted">まだ給料明細は届いていません。会社が発行すると、ここに届きます。</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      {companies.map((c) => (
        <section key={c.companyId} className="flex flex-col gap-2">
          {companies.length > 1 ? <h2 className="text-sm font-semibold text-muted">{c.companyName}</h2> : null}
          {!c.consented ? (
            <div className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-black/5">
              <p className="mb-2">
                {c.companyName}から給料明細が届いています。アプリで見るには、給料明細を電子で受け取ることへの同意が必要です。
              </p>
              <p className="mb-3 text-xs text-muted">同意しない場合は、これまで通り会社から紙などで受け取ってください。</p>
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => consentToElectronicPayslipAction(c.companyId))}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                電子で受け取ることに同意する
              </button>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {c.slips.map((s) => {
                const [y, m] = s.targetMonth.split("-").map(Number);
                return (
                  <li key={s.id}>
                    <PdfLink
                      href={`/api/salary-slips/${s.id}/pdf?issueId=${s.issueId}`}
                      className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/5"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-foreground">
                          {y}年{m}月分 {s.isContractor ? "支払明細" : "給与明細"}
                          {s.revised ? <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">修正済み</span> : null}
                        </span>
                        <span className="block text-xs text-muted">発行日 {s.issuedAt}</span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-primary">{s.net.toLocaleString()}円</span>
                    </PdfLink>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
