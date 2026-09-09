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
  wageType: string | null;
  extraItems: { label: string; value: string }[];
  maxEntries: number;
  filled: number;
  alreadyApplied: boolean;
};

// カードを直接「応募する」にせず、まずタップで詳細を開いてから応募する
// 2段階の導線にした（内容を見ずにボタン一発で応募してしまうのを防ぐ）。
// 業務内容・就業先・日時はどれも同格で大事な情報なので、同じ見た目の
// ラベル＋値で並べて表示する。
export function RecruitmentListView({ recruitments }: { recruitments: Row[] }) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const [detailTarget, setDetailTarget] = useState<Row | null>(null);

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
        setDetailTarget(null);
      }
    });
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {recruitments.map((r) => {
          const remaining = Math.max(r.maxEntries - r.filled, 0);
          const isFull = remaining <= 0;
          const isApplied = applied[r.id] || r.alreadyApplied;
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setDetailTarget(r)}
                className="block w-full rounded-xl border border-border bg-white/60 p-4 text-left hover:border-primary"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-muted">残り{remaining}名</span>
                  {isApplied ? (
                    <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">応募済み</span>
                  ) : isFull ? (
                    <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted">満員</span>
                  ) : null}
                </div>
                <RecruitmentSummary row={r} />
              </button>
            </li>
          );
        })}
        {recruitments.length === 0 ? (
          <p className="text-sm text-muted">現在募集中のシフトはありません。</p>
        ) : null}
      </ul>

      {detailTarget ? (
        <RecruitmentDetailModal
          row={detailTarget}
          pending={pending}
          error={errors[detailTarget.id]}
          isApplied={applied[detailTarget.id] || detailTarget.alreadyApplied}
          onApply={() => apply(detailTarget.id)}
          onClose={() => setDetailTarget(null)}
        />
      ) : null}
    </>
  );
}

function RecruitmentSummary({ row }: { row: Row }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div>
        <span className="mr-1 text-xs text-muted">業務内容</span>
        {row.title}
      </div>
      <div>
        <span className="mr-1 text-xs text-muted">就業先</span>
        {row.companyName}
      </div>
      <div>
        <span className="mr-1 text-xs text-muted">日時</span>
        {row.date} {row.startTime}〜{row.endTime}
      </div>
    </div>
  );
}

function RecruitmentDetailModal({
  row,
  pending,
  error,
  isApplied,
  onApply,
  onClose,
}: {
  row: Row;
  pending: boolean;
  error?: string;
  isApplied: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  const remaining = Math.max(row.maxEntries - row.filled, 0);
  const isFull = remaining <= 0;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">募集詳細</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>

        <RecruitmentSummary row={row} />

        {row.hourlyWage ? (
          <p className="mt-3 text-sm">
            <span className="mr-1 text-xs text-muted">給与</span>
            {row.wageType === "DAILY" ? "日給" : "時給"}
            {row.hourlyWage}円
          </p>
        ) : null}

        {row.extraItems.length > 0 ? (
          <div className="mt-3 flex flex-col gap-0.5">
            {row.extraItems.map((item) => (
              <p key={item.label} className="text-sm">
                <span className="mr-1 text-xs text-muted">{item.label}</span>
                {item.value}
              </p>
            ))}
          </div>
        ) : null}

        <p className="mt-3 text-xs text-muted">残り{remaining}名</p>
        {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}

        <button
          type="button"
          disabled={pending || isFull || isApplied}
          onClick={onApply}
          className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {isApplied ? "応募済み" : isFull ? "満員" : "応募する"}
        </button>
      </div>
    </div>
  );
}
