"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addPlacementRateVersionAction,
  addStaffTaskRateVersionAction,
  movePlacementRateStartAction,
  moveStaffTaskRateStartAction,
} from "@/app/company/contracts/actions";

export type RateFixItem = {
  date: string;
  taskName: string | null;
  rateId: string | null;
  rateStartsFrom: string | null;
  companyRelationshipId?: string | null;
};

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

// 請求書・給料明細の「単価が決まらない勤務」を、業務内容ごとに理由を分けて出し、その場で直せるようにする。
// ・単価がまだ無い →「単価を入れる」（開始日は一番古い勤務日）
// ・単価はあるが、開始日が勤務日より後 →「開始日を◯/◯に直す」か「この期間だけ別の単価を入れる」
// client：依頼主への請求単価（請求書）／staff：スタッフの業務内容単価（給料明細。無い時は基本給で計算している）
export function RateFixList({
  kind,
  items,
  companyRelationshipId,
  staffUserId,
}: {
  kind: "client" | "staff";
  items: RateFixItem[];
  companyRelationshipId?: string;
  staffUserId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formKey, setFormKey] = useState<string | null>(null);
  const [wageType, setWageType] = useState<"HOURLY" | "DAILY">("DAILY");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState("");
  const [error, setError] = useState<string | null>(null);

  const groups = new Map<string, { item: RateFixItem; dates: string[] }>();
  for (const it of items) {
    const key = [it.taskName ?? "", it.rateId ?? "", it.rateStartsFrom ?? "", it.companyRelationshipId ?? ""].join("|");
    const g = groups.get(key) ?? { item: it, dates: [] };
    g.dates.push(it.date);
    groups.set(key, g);
  }
  const fallback = kind === "staff" ? "基本給で計算しています" : "請求書に入っていません";

  function run(fn: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        setFormKey(null);
        router.refresh();
      } catch {
        setError("保存できませんでした。もう一度お試しください。");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2" data-testid="rate-fix-list">
      {[...groups.entries()].map(([key, { item, dates }]) => {
        const sorted = [...dates].sort();
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const range = first === last ? md(first) : `${md(first)}〜${md(last)}`;
        const task = item.taskName;
        const openForm = () => {
          setFormKey(key);
          setFrom(first);
          setAmount("");
          setError(null);
        };
        return (
          <div key={key} className="rounded-lg bg-white/70 px-3 py-2 text-xs" data-testid="rate-fix-group">
            {!task ? (
              <p>業務内容が入っていない勤務（{range}・{sorted.length}件）は、単価が決まらないため{fallback}。業務報告で業務内容を直してください。</p>
            ) : item.rateStartsFrom ? (
              <p>
                「{task}」の単価は{md(item.rateStartsFrom)}からです。{range}の勤務（{sorted.length}件）は単価の開始日より前のため、{fallback}。
              </p>
            ) : (
              <p>
                「{task}」の単価がまだ登録されていません（{range}・{sorted.length}件。{fallback}）。
              </p>
            )}
            {task ? (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {item.rateStartsFrom && item.rateId ? (
                  <>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          kind === "client"
                            ? movePlacementRateStartAction(item.rateId!, first)
                            : moveStaffTaskRateStartAction(item.rateId!, first),
                        )
                      }
                      className="rounded-md bg-primary px-2.5 py-1 font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      開始日を{md(first)}に直す
                    </button>
                    <button type="button" onClick={openForm} className="rounded-md border border-primary/40 bg-white px-2.5 py-1 font-semibold text-primary">
                      この期間だけ別の単価を入れる
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={openForm} className="rounded-md bg-primary px-2.5 py-1 font-semibold text-primary-foreground">
                    単価を入れる
                  </button>
                )}
              </div>
            ) : null}
            {formKey === key && task ? (
              <div className="mt-2 flex flex-wrap items-end gap-2" data-testid="rate-fix-form">
                <select
                  value={wageType}
                  onChange={(e) => setWageType(e.target.value as "HOURLY" | "DAILY")}
                  className="rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-foreground"
                  aria-label="単価の種類"
                >
                  <option value="DAILY">日給</option>
                  <option value="HOURLY">時給</option>
                </select>
                <input
                  type="number"
                  min="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="金額"
                  aria-label="金額"
                  className="w-24 rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-foreground"
                />
                <label className="flex flex-col gap-0.5">
                  <span className="text-muted">開始日</span>
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-foreground"
                  />
                </label>
                <button
                  type="button"
                  disabled={pending || !amount || Number(amount) <= 0 || !from}
                  onClick={() =>
                    run(() =>
                      kind === "client"
                        ? addPlacementRateVersionAction({
                            companyRelationshipId,
                            taskName: task,
                            wageType,
                            amount: Number(amount),
                            effectiveFrom: from,
                          })
                        : addStaffTaskRateVersionAction({
                            staffUserId: staffUserId!,
                            taskName: task,
                            companyRelationshipId: item.companyRelationshipId ?? undefined,
                            wageType,
                            amount: Number(amount),
                            effectiveFrom: from,
                          }),
                    )
                  }
                  className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  保存
                </button>
                <button type="button" onClick={() => setFormKey(null)} className="text-muted underline">
                  やめる
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
