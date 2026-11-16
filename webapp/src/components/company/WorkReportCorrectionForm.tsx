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
  workplaceOptions,
  currentRelationshipId = null,
  workplaceLocked = false,
}: {
  workReportId: string;
  initialClockIn: string | null;
  initialClockOut: string | null;
  initialBreakMinutes: number;
  onDone: () => void;
  // 勤務先も選び直せるようにする時の選択肢（社内と自社の依頼主）。依頼主のオーダーから入ったシフトなどは変えられない
  workplaceOptions?: { id: string; name: string }[];
  currentRelationshipId?: string | null;
  workplaceLocked?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [clockIn, setClockIn] = useState(initialClockIn ?? "");
  const [clockOut, setClockOut] = useState(initialClockOut ?? "");
  const [breakMinutes, setBreakMinutes] = useState(String(initialBreakMinutes));
  const [error, setError] = useState<string | null>(null);
  const [workplace, setWorkplace] = useState(currentRelationshipId ?? "");
  const canChangeWorkplace = Boolean(workplaceOptions) && !workplaceLocked;

  function submit() {
    if (!clockIn || !clockOut) return;
    setError(null);
    startTransition(async () => {
      const result = await correctWorkReportAction({
        workReportId,
        clockIn,
        clockOut,
        breakMinutes: Number(breakMinutes) || 0,
        companyRelationshipId: canChangeWorkplace ? workplace : undefined,
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
      {canChangeWorkplace ? (
        <label className="mt-2 flex flex-col gap-0.5 text-xs">
          <span className="text-muted">勤務先（違っていた時だけ変える。単価も変えた勤務先のものになります）</span>
          <select
            value={workplace}
            onChange={(e) => setWorkplace(e.target.value)}
            className="rounded-lg border border-border bg-white px-2 py-2 text-sm text-foreground"
            data-testid="correction-workplace"
          >
            <option value="">社内</option>
            {workplaceOptions!.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
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
