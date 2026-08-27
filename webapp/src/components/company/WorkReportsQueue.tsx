"use client";

import { useTransition } from "react";
import { approveWorkReportAction, rejectWorkReportAction } from "@/app/company/workreports/actions";

type Row = {
  id: string;
  staffName: string;
  outcome: string;
  date: string;
  computedHours: string;
  comment: string | null;
  taskName: string | null;
};

export function WorkReportsQueue({ reports }: { reports: Row[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-2xl border border-border bg-white/60 p-6">
      {reports.length === 0 ? (
        <p className="text-center text-sm text-muted">承認待ちの業務報告はありません。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {reports.map((r) => (
            <li key={r.id} className="rounded-xl border border-border/60 p-4">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">
                  {r.staffName} — {r.date}
                  {r.taskName ? <span className="ml-1.5 font-normal text-muted">（{r.taskName}）</span> : null}
                </span>
                <span className="text-xs text-muted">{r.outcome}</span>
              </div>
              {r.outcome === "出勤した" ? (
                <p className="text-sm text-muted">実働 {r.computedHours} 時間</p>
              ) : null}
              {r.comment ? <p className="text-sm text-muted">コメント: {r.comment}</p> : null}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => approveWorkReportAction(r.id))}
                  className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  承認する
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => rejectWorkReportAction(r.id))}
                  className="rounded-lg border border-border px-4 py-1.5 text-sm text-foreground/70 disabled:opacity-60"
                >
                  差し戻す
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
