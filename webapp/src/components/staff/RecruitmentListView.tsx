"use client";

import { useState, useTransition } from "react";
import { applyToRecruitmentAction } from "@/app/staff/actions";

type Row = {
  id: string;
  title: string;
  companyName: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  hourlyWage: number | null;
  maxEntries: number;
  filled: number;
  alreadyApplied: boolean;
};

export function RecruitmentListView({ recruitments }: { recruitments: Row[] }) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<Record<string, boolean>>({});

  function apply(id: string) {
    startTransition(async () => {
      const result = await applyToRecruitmentAction(id);
      if (result.error) {
        setErrors((prev) => ({
          ...prev,
          [id]: result.error === "recruitment_full" ? "満員になりました。" : "応募できませんでした。",
        }));
      } else {
        setApplied((prev) => ({ ...prev, [id]: true }));
      }
    });
  }

  return (
    <ul className="flex flex-col gap-3">
      {recruitments.map((r) => {
        const remaining = Math.max(r.maxEntries - r.filled, 0);
        const isFull = remaining <= 0;
        const isApplied = applied[r.id] || r.alreadyApplied;
        return (
          <li key={r.id} className="rounded-xl border border-border bg-white/60 p-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold">{r.title}</span>
              <span className="text-xs text-muted">残り{remaining}名</span>
            </div>
            <p className="text-sm text-muted">{r.companyName}</p>
            <p className="text-sm text-muted">
              {r.date} {r.startTime}〜{r.endTime}
              {r.hourlyWage ? ` ／ 時給${r.hourlyWage}円` : ""}
            </p>
            {errors[r.id] ? <p className="mt-1 text-xs text-red-600">{errors[r.id]}</p> : null}
            <button
              type="button"
              disabled={pending || isFull || isApplied}
              onClick={() => apply(r.id)}
              className="mt-3 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {isApplied ? "応募済み" : isFull ? "満員" : "応募する"}
            </button>
          </li>
        );
      })}
      {recruitments.length === 0 ? (
        <p className="text-sm text-muted">現在募集中のシフトはありません。</p>
      ) : null}
    </ul>
  );
}
