"use client";

import { useState, useTransition } from "react";
import { correctWorkReportAction } from "@/app/company/workreports/actions";

// 「時間を直して確認してもらう」の入力欄。設定＞業務報告タブとダッシュボード
// の業務報告ポップアップの両方から同じ操作をできるよう共通化している。
export function WorkReportCorrectionForm({
  workReportId,
  initialClockIn,
  initialClockOut,
  initialBreakMinutes,
  onDone,
}: {
  workReportId: string;
  initialClockIn: string | null;
  initialClockOut: string | null;
  initialBreakMinutes: number;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [clockIn, setClockIn] = useState(initialClockIn ?? "");
  const [clockOut, setClockOut] = useState(initialClockOut ?? "");
  const [breakMinutes, setBreakMinutes] = useState(String(initialBreakMinutes));
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!clockIn || !clockOut) return;
    setError(null);
    startTransition(async () => {
      const result = await correctWorkReportAction({
        workReportId,
        clockIn,
        clockOut,
        breakMinutes: Number(breakMinutes) || 0,
      });
      if (result.status === "error") {
        setError(result.reason);
        return;
      }
      onDone();
    });
  }

  return (
    <div>
      <p className="mb-3 text-xs text-muted">
        修正するとスタッフに「これで合っています」の確認を求める通知が届きます。スタッフが確認するまでは承認済みになりません（スタッフが「内容が違う」を選んだ場合は差し戻しに戻ります）。
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-xs">
          <span className="text-muted">出勤時刻</span>
          <input
            type="time"
            value={clockIn}
            onChange={(e) => setClockIn(e.target.value)}
            className="rounded-lg border border-border px-2 py-2 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs">
          <span className="text-muted">退勤時刻</span>
          <input
            type="time"
            value={clockOut}
            onChange={(e) => setClockOut(e.target.value)}
            className="rounded-lg border border-border px-2 py-2 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs">
          <span className="text-muted">休憩（分）</span>
          <input
            type="number"
            min="0"
            value={breakMinutes}
            onChange={(e) => setBreakMinutes(e.target.value)}
            className="w-20 rounded-lg border border-border px-2 py-2 text-sm text-foreground"
          />
        </label>
      </div>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      <button
        type="button"
        disabled={pending || !clockIn || !clockOut}
        onClick={submit}
        className="mt-3 self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        保存してスタッフに確認してもらう
      </button>
    </div>
  );
}
