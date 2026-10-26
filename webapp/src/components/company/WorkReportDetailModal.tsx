"use client";

import { useEffect, useState } from "react";
import { getWorkReportDetailAction } from "@/app/company/actions";
import type { WorkReportDetail } from "@/lib/domain/workReports";

const OUTCOME_LABEL: Record<string, string> = {
  WORKED: "出勤",
  ABSENT: "欠勤",
  CANCELLED_BY_EMPLOYER: "勤務先キャンセル",
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: "未承認",
  APPROVED: "承認済み",
  REJECTED: "差戻し",
  NEEDS_CONFIRMATION: "スタッフの確認待ち",
};
const STATUS_PILL: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-sky-100 text-sky-800",
  REJECTED: "bg-rose-100 text-rose-800",
  NEEDS_CONFIRMATION: "bg-accent/20 text-accent",
};

function minutesLabel(minutes: number) {
  return `${Math.floor(minutes / 60)}時間${String(minutes % 60).padStart(2, "0")}分`;
}

// スタッフ詳細の稼働履歴・カレンダーの日別詳細から開く業務報告の詳細。
// 差し戻した後も理由や経緯を確認できるようにする。
export function WorkReportDetailModal({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<WorkReportDetail | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getWorkReportDetailAction(shiftId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [shiftId]);

  return (
    // 親（スタッフ詳細パネル・日別詳細）の「外側クリックで閉じる」まで
    // クリックが伝わらないよう、ここで止める
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="業務報告の詳細"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">業務報告の詳細</h3>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-muted hover:text-primary">
            ✕
          </button>
        </div>

        {error ? (
          <p className="py-6 text-center text-sm text-red-600">読み込めませんでした。</p>
        ) : !detail ? (
          <p className="py-6 text-center text-sm text-muted">読み込み中…</p>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <div>
              <p className="font-semibold">
                {detail.date.slice(5).replace("-", "/")}　{detail.staffName}
              </p>
              <p className="text-xs text-muted">
                {detail.workplaceLabel}
                {detail.taskName ? `・${detail.taskName}` : ""}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {detail.submitted ? (
                <>
                  <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">
                    {OUTCOME_LABEL[detail.outcome!] ?? detail.outcome}
                  </span>
                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ${STATUS_PILL[detail.approvalStatus!] ?? ""}`}>
                    {STATUS_LABEL[detail.approvalStatus!] ?? detail.approvalStatus}
                  </span>
                </>
              ) : (
                <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">未提出</span>
              )}
            </div>

            {detail.outcome === "ABSENT" || detail.outcome === "CANCELLED_BY_EMPLOYER" ? null : (
              <dl className="grid grid-cols-[80px_1fr] gap-y-1.5 rounded-xl bg-background px-3 py-2.5 text-xs">
                <dt className="text-muted">出勤〜退勤</dt>
                <dd>{detail.clockIn || detail.clockOut ? `${detail.clockIn ?? "--:--"}〜${detail.clockOut ?? "--:--"}` : "打刻なし"}</dd>
                {detail.submitted ? (
                  <>
                    <dt className="text-muted">休憩</dt>
                    <dd>{detail.breakMinutes}分</dd>
                    <dt className="text-muted">実働</dt>
                    <dd>{minutesLabel(detail.computedMinutes)}</dd>
                  </>
                ) : null}
              </dl>
            )}

            {!detail.submitted ? (
              <p className="text-xs text-muted">スタッフがまだ業務報告を提出していません。</p>
            ) : null}

            {detail.comment ? (
              <div>
                <p className="mb-1 text-xs text-muted">スタッフのコメント</p>
                <p className="whitespace-pre-wrap break-words rounded-xl bg-background px-3 py-2 text-xs">{detail.comment}</p>
              </div>
            ) : null}

            {detail.timeline.length > 0 ? (
              <div>
                <p className="mb-1 text-xs text-muted">経緯</p>
                <ul className="flex flex-col gap-2">
                  {detail.timeline.map((t, i) => (
                    <li key={i} className="text-xs">
                      <span className="font-semibold">{t.label}</span>
                      <span className="ml-2 text-muted">
                        {t.at ?? ""}
                        {t.by ? `　${t.by}` : ""}
                      </span>
                      {t.note ? (
                        <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-rose-50 px-2.5 py-1.5 text-rose-900">
                          理由：{t.note}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {detail.previousRejectionReason ? (
              <p className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs text-muted">
                前回の差戻し理由：{detail.previousRejectionReason}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
