"use client";

import { useState, useTransition } from "react";
import { approveWorkReportAction, rejectWorkReportAction } from "@/app/company/workreports/actions";
import { WorkReportCorrectionForm } from "@/components/company/WorkReportCorrectionForm";

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
  isUnscheduled: boolean;
};

export function WorkReportsQueue({ reports }: { reports: Row[] }) {
  const [pending, startTransition] = useTransition();
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function approve(reportId: string) {
    setErrors((prev) => ({ ...prev, [reportId]: "" }));
    startTransition(async () => {
      const result = await approveWorkReportAction(reportId);
      if (result.status === "error") setErrors((prev) => ({ ...prev, [reportId]: result.reason }));
    });
  }

  function submitReject() {
    if (!rejectingId || !rejectionReason.trim()) return;
    const reportId = rejectingId;
    setErrors((prev) => ({ ...prev, [reportId]: "" }));
    startTransition(async () => {
      const result = await rejectWorkReportAction(reportId, rejectionReason.trim());
      if (result.status === "error") {
        setErrors((prev) => ({ ...prev, [reportId]: result.reason }));
        return;
      }
      setRejectingId(null);
      setRejectionReason("");
    });
  }

  const correctingReport = reports.find((r) => r.id === correctingId) ?? null;
  const rejectingReport = reports.find((r) => r.id === rejectingId) ?? null;

  return (
    <div className="rounded-2xl border border-border bg-white/60 p-6">
      {reports.length === 0 ? (
        <p className="text-center text-sm text-muted">承認待ちの業務報告はありません。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {reports.map((r) => (
            <li key={r.id} className="rounded-xl border border-border/60 p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="min-w-0 font-medium">
                  {r.isUnscheduled ? <UnscheduledBadge /> : null}
                  {r.staffName} — {r.date}
                  {r.taskName ? <span className="ml-1.5 font-normal text-muted">（{r.taskName}）</span> : null}
                </span>
                <span className="shrink-0 whitespace-nowrap text-xs text-muted">{r.outcome}</span>
              </div>
              {r.outcome === "出勤した" ? (
                <p className="text-sm text-muted">
                  実働 {r.computedHours} 時間（{r.clockInTime ?? "--:--"}〜{r.clockOutTime ?? "--:--"} ／ 休憩{r.breakMinutes}分）
                </p>
              ) : null}
              {r.comment ? <p className="text-sm text-muted">コメント: {r.comment}</p> : null}
              {errors[r.id] ? <p className="mt-1 text-xs text-red-600">{errors[r.id]}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => approve(r.id)}
                  className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  承認する
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setRejectingId(r.id);
                    setRejectionReason("");
                  }}
                  className="rounded-lg border border-border px-4 py-1.5 text-sm text-foreground/70 disabled:opacity-60"
                >
                  スタッフに直してもらう
                </button>
                {r.outcome === "出勤した" ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setCorrectingId(r.id)}
                    className="rounded-lg border border-border px-4 py-1.5 text-sm text-foreground/70 disabled:opacity-60"
                  >
                    時間を直して確認してもらう
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
                時間を直して確認してもらう（{correctingReport.staffName} — {correctingReport.date}）
              </h4>
              <button type="button" onClick={() => setCorrectingId(null)} aria-label="閉じる" className="text-muted hover:text-primary">
                ✕
              </button>
            </div>
            <WorkReportCorrectionForm
              workReportId={correctingReport.id}
              initialClockIn={correctingReport.clockInTime}
              initialClockOut={correctingReport.clockOutTime}
              initialBreakMinutes={correctingReport.breakMinutes}
              onDone={() => setCorrectingId(null)}
            />
          </div>
        </div>
      ) : null}

      {rejectingReport ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setRejectingId(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-serif-jp text-base font-bold text-primary">
                スタッフに直してもらう（{rejectingReport.staffName} — {rejectingReport.date}）
              </h4>
              <button type="button" onClick={() => setRejectingId(null)} aria-label="閉じる" className="text-muted hover:text-primary">
                ✕
              </button>
            </div>
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="text-muted">直してほしい内容（スタッフに表示されます。スタッフが自分で直して再提出します）</span>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="例：業務内容を具体的に記入してください"
                className="rounded-lg border border-border px-3 py-2 text-sm text-foreground"
                rows={3}
              />
            </label>
            {rejectingReport && errors[rejectingReport.id] ? (
              <p className="mt-2 text-xs text-red-600">{errors[rejectingReport.id]}</p>
            ) : null}
            <button
              type="button"
              disabled={pending || !rejectionReason.trim()}
              onClick={submitReject}
              className="mt-3 self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              スタッフに戻す
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// シフトが無いままスタッフが報告した勤務（緊急の出勤など）であることを示す印。
// 会社側が事前に把握していない勤務なので、承認前に気付けるようにする。
export function UnscheduledBadge() {
  return (
    <span className="mr-1.5 inline-block rounded-md bg-amber-100 px-1.5 py-0.5 align-middle text-[11px] font-semibold text-amber-900">
      シフト外
    </span>
  );
}
