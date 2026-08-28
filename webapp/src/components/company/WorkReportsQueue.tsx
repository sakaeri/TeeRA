"use client";

import { useState, useTransition } from "react";
import { approveWorkReportAction, rejectWorkReportAction, correctWorkReportAction } from "@/app/company/workreports/actions";

type Row = {
  id: string;
  staffName: string;
  outcome: string;
  date: string;
  computedHours: string;
  comment: string | null;
  taskName: string | null;
  clockInTime: string | null;
  clockOutTime: string | null;
  breakMinutes: number;
};

export function WorkReportsQueue({ reports }: { reports: Row[] }) {
  const [pending, startTransition] = useTransition();
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("0");

  function startCorrect(r: Row) {
    setCorrectingId(r.id);
    setClockIn(r.clockInTime ?? "");
    setClockOut(r.clockOutTime ?? "");
    setBreakMinutes(String(r.breakMinutes));
  }

  function submitCorrect() {
    if (!correctingId || !clockIn || !clockOut) return;
    startTransition(async () => {
      await correctWorkReportAction({
        workReportId: correctingId,
        clockIn,
        clockOut,
        breakMinutes: Number(breakMinutes) || 0,
      });
      setCorrectingId(null);
    });
  }

  const correctingReport = reports.find((r) => r.id === correctingId) ?? null;

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
                <p className="text-sm text-muted">
                  実働 {r.computedHours} 時間（{r.clockInTime ?? "--:--"}〜{r.clockOutTime ?? "--:--"} ／ 休憩{r.breakMinutes}分）
                </p>
              ) : null}
              {r.comment ? <p className="text-sm text-muted">コメント: {r.comment}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
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
                {r.outcome === "出勤した" ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => startCorrect(r)}
                    className="rounded-lg border border-border px-4 py-1.5 text-sm text-foreground/70 disabled:opacity-60"
                  >
                    修正して差し戻す
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {correctingReport ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setCorrectingId(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-serif-jp text-base font-bold text-primary">
                打刻を修正して差し戻す（{correctingReport.staffName} — {correctingReport.date}）
              </h4>
              <button type="button" onClick={() => setCorrectingId(null)} aria-label="閉じる" className="text-muted hover:text-primary">
                ✕
              </button>
            </div>
            <p className="mb-3 text-xs text-muted">
              修正するとスタッフに「これで合っています」の確認を求める通知が届きます。スタッフが確認するまでは承認済みになりません。
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-0.5 text-xs text-muted">
                出勤時刻
                <input
                  type="time"
                  value={clockIn}
                  onChange={(e) => setClockIn(e.target.value)}
                  className="rounded-lg border border-border px-2 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-xs text-muted">
                退勤時刻
                <input
                  type="time"
                  value={clockOut}
                  onChange={(e) => setClockOut(e.target.value)}
                  className="rounded-lg border border-border px-2 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-xs text-muted">
                休憩（分）
                <input
                  type="number"
                  min="0"
                  value={breakMinutes}
                  onChange={(e) => setBreakMinutes(e.target.value)}
                  className="w-20 rounded-lg border border-border px-2 py-2 text-sm"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={pending || !clockIn || !clockOut}
              onClick={submitCorrect}
              className="mt-3 self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              保存
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
