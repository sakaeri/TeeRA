"use client";

import { useState, useTransition } from "react";
import {
  clockInAction,
  clockOutAction,
  submitWorkReportAction,
} from "@/app/staff/actions";

type ShiftRow = {
  id: string;
  date: string;
  companyName: string;
  startTime: string | null;
  endTime: string | null;
  clockIn: string | null;
  clockOut: string | null;
  outcome: string | null;
  approvalStatus: string | null;
  computedMinutes: number;
};

const APPROVAL_LABEL: Record<string, string> = {
  PENDING: "承認待ち",
  APPROVED: "承認済み",
  REJECTED: "差し戻し",
};

export function StaffTimecardView({ shifts }: { shifts: ShiftRow[] }) {
  return (
    <ul className="flex flex-col gap-4">
      {shifts.map((s) => (
        <ShiftCard key={s.id} shift={s} />
      ))}
      {shifts.length === 0 ? (
        <p className="text-sm text-muted">対象のシフトがありません。</p>
      ) : null}
    </ul>
  );
}

function ShiftCard({ shift }: { shift: ShiftRow }) {
  const [pending, startTransition] = useTransition();
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const finalized = shift.outcome && shift.outcome !== "WORKED";
  const readyToSubmit = shift.clockIn && shift.clockOut;

  return (
    <li className="rounded-xl border border-border bg-white/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">
          {shift.date} — {shift.companyName}
        </span>
        {shift.approvalStatus ? (
          <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
            {APPROVAL_LABEL[shift.approvalStatus] ?? shift.approvalStatus}
          </span>
        ) : null}
      </div>
      <p className="mb-2 text-sm text-muted">
        {shift.startTime ? `${shift.startTime}〜${shift.endTime}` : "終日/未定"}
      </p>

      {finalized ? (
        <p className="text-sm text-muted">
          {shift.outcome === "ABSENT" ? "欠勤として報告済みです。" : "勤務先からのキャンセルとして報告済みです。"}
        </p>
      ) : (
        <>
          {!shift.clockIn ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(() => clockInAction(shift.id))}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              出勤
            </button>
          ) : !shift.clockOut ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(() => clockOutAction(shift.id))}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              退勤
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted">実働 {(shift.computedMinutes / 60).toFixed(1)} 時間</p>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="コメント（任意）"
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                rows={2}
              />
              {error ? <p className="text-xs text-red-600">{error}</p> : null}
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    try {
                      await submitWorkReportAction({
                        shiftId: shift.id,
                        outcome: "WORKED",
                        comment: comment || undefined,
                      });
                    } catch {
                      setError("提出に失敗しました。");
                    }
                  })
                }
                className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                業務報告を提出する
              </button>
            </div>
          )}

          {!readyToSubmit ? (
            <div className="mt-2 flex gap-3 text-xs text-muted">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(() =>
                    submitWorkReportAction({ shiftId: shift.id, outcome: "ABSENT" }),
                  )
                }
                className="underline"
              >
                欠勤
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(() =>
                    submitWorkReportAction({
                      shiftId: shift.id,
                      outcome: "CANCELLED_BY_EMPLOYER",
                    }),
                  )
                }
                className="underline"
              >
                勤務先からのキャンセル
              </button>
            </div>
          ) : null}
        </>
      )}
    </li>
  );
}
