"use client";

import { useState, useTransition } from "react";
import { applyToRecruitmentAction } from "@/app/staff/actions";

type Row = {
  id: string;
  title: string;
  companyName: string;
  visibility: "ORDER" | "PUBLIC";
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

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatDateJa(dateStr: string) {
  const [, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return `${m}月${d}日（${WEEKDAYS[dow]}）`;
}

// 見出しは「日付」「募集企業名・残り人数」だけに絞り、業務内容・時間・
// 給与などの詳細は▼で開くまで隠す。応募するかどうかは詳細を見てから
// 判断するものなので、タップで展開→内容確認→応募する、という導線は
// そのまま保つ（一発ボタンでの誤応募を防ぐ）。
export function RecruitmentListView({ recruitments }: { recruitments: Row[] }) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const [openId, setOpenId] = useState<string | null>(null);

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
    <ul className="flex flex-col gap-2">
      {recruitments.map((r) => {
        const remaining = Math.max(r.maxEntries - r.filled, 0);
        const isFull = remaining <= 0;
        const isApplied = applied[r.id] || r.alreadyApplied;
        const open = openId === r.id;
        return (
          <li
            key={r.id}
            data-testid={`recruitment-${r.id}`}
            className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5"
          >
            <button
              type="button"
              onClick={() => setOpenId(open ? null : r.id)}
              className="flex w-full flex-col gap-1 px-4 py-3 text-left"
            >
              <span className="text-xs text-muted">{formatDateJa(r.date)}</span>
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-foreground">
                  {r.visibility === "PUBLIC" ? (
                    <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
                      公開募集
                    </span>
                  ) : null}
                  <span className="truncate">{r.companyName}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                  {isApplied ? (
                    <span className="rounded-full bg-accent/20 px-2 py-0.5 text-accent">応募済み</span>
                  ) : isFull ? (
                    <span className="rounded-full bg-background px-2 py-0.5">満員</span>
                  ) : (
                    <span>残り{remaining}名</span>
                  )}
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                  >
                    <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </div>
            </button>
            {open ? (
              <div className="flex flex-col gap-2 border-t border-black/5 px-4 py-3 text-sm">
                <p>
                  <span className="mr-1 text-xs text-muted">業務内容</span>
                  {r.title}
                </p>
                <p>
                  <span className="mr-1 text-xs text-muted">時間</span>
                  {r.startTime}〜{r.endTime}
                </p>
                {r.hourlyWage ? (
                  <p>
                    <span className="mr-1 text-xs text-muted">給与</span>
                    {r.wageType === "DAILY" ? "日給" : "時給"}
                    {r.hourlyWage}円
                  </p>
                ) : null}
                {r.extraItems.map((item) => (
                  <p key={item.label}>
                    <span className="mr-1 text-xs text-muted">{item.label}</span>
                    {item.value}
                  </p>
                ))}
                {errors[r.id] ? <p className="text-xs text-red-600">{errors[r.id]}</p> : null}
                <button
                  type="button"
                  disabled={pending || isFull || isApplied}
                  onClick={() => apply(r.id)}
                  className="mt-1 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {isApplied ? "応募済み" : isFull ? "満員" : "応募する"}
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
      {recruitments.length === 0 ? (
        <p className="text-sm text-muted">現在募集中のシフトはありません。</p>
      ) : null}
    </ul>
  );
}
