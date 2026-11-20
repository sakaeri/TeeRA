"use client";

import { useEffect, useState, useTransition } from "react";
import { correctWorkReportAction, listCorrectionTaskNamesAction } from "@/app/company/workreports/actions";

const NEW_TASK_NAME = "__new__";

// 「時間・勤務先を直す」の入力欄。設定＞業務報告タブ・ダッシュボードの業務報告ポップアップ・
// 業務報告の詳細から同じ操作をできるよう共通化している。
export function WorkReportCorrectionForm({
  workReportId,
  initialClockIn,
  initialClockOut,
  initialBreakMinutes,
  initialTaskName = null,
  onDone,
  workplaceOptions,
  currentRelationshipId = null,
  workplaceLocked = false,
}: {
  workReportId: string;
  initialClockIn: string | null;
  initialClockOut: string | null;
  initialBreakMinutes: number;
  initialTaskName?: string | null;
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
  // 業務内容：勤務先の単価に登録されている業務内容から選ぶ（無ければ新しく入力）
  const [taskName, setTaskName] = useState(initialTaskName ?? "");
  const [taskNamesByWorkplace, setTaskNamesByWorkplace] = useState<Record<string, string[]> | null>(null);
  const [customTaskName, setCustomTaskName] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listCorrectionTaskNamesAction(workReportId)
      .then((map) => {
        if (!cancelled) setTaskNamesByWorkplace(map);
      })
      .catch(() => {
        if (!cancelled) setTaskNamesByWorkplace({});
      });
    return () => {
      cancelled = true;
    };
  }, [workReportId]);

  const workplaceTaskNames = taskNamesByWorkplace?.[workplace] ?? [];
  // 今入っている業務内容は、単価に無くても選べるように残す
  const taskOptions =
    initialTaskName && !workplaceTaskNames.includes(initialTaskName) && workplace === (currentRelationshipId ?? "")
      ? [initialTaskName, ...workplaceTaskNames]
      : workplaceTaskNames;
  const showTaskInput = customTaskName || (taskNamesByWorkplace !== null && taskOptions.length === 0);

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
        taskName: taskName.trim() !== (initialTaskName ?? "") ? taskName : undefined,
      });
      if (result.status === "error") {
        setError(result.reason);
        return;
      }
      onDone();
    });
  }

  const inputClass = "w-full rounded-lg border border-border bg-white px-2 py-2 text-sm text-foreground";
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-xs text-muted">直した内容は、スタッフが「これで合っています」を押すと承認済みになります。</p>
      {/* 時刻は狭いと「09:00 AM」が切れるので2列。休憩と業務内容は次の段に並べる */}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5 text-xs">
          <span className="text-muted">出勤時刻</span>
          <input type="time" value={clockIn} onChange={(e) => setClockIn(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-0.5 text-xs">
          <span className="text-muted">退勤時刻</span>
          <input type="time" value={clockOut} onChange={(e) => setClockOut(e.target.value)} className={inputClass} />
        </label>
      </div>
      <div className="grid grid-cols-[5rem_1fr] gap-2">
        <label className="flex flex-col gap-0.5 text-xs">
          <span className="text-muted">休憩（分）</span>
          <input
            type="number"
            min="0"
            value={breakMinutes}
            onChange={(e) => setBreakMinutes(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 text-xs">
          <span className="text-muted">業務内容</span>
          {showTaskInput ? (
            <input
              type="text"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="業務内容を入力"
              className={inputClass}
              data-testid="correction-task-name-input"
            />
          ) : (
            <select
              value={taskName}
              onChange={(e) => {
                if (e.target.value === NEW_TASK_NAME) {
                  setCustomTaskName(true);
                  setTaskName("");
                } else {
                  setTaskName(e.target.value);
                }
              }}
              className={inputClass}
              data-testid="correction-task-name"
            >
              <option value="">未選択</option>
              {taskOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value={NEW_TASK_NAME}>＋ 新しい業務内容</option>
            </select>
          )}
        </label>
      </div>
      {canChangeWorkplace ? (
        <label className="flex flex-col gap-0.5 text-xs">
          <span className="text-muted">勤務先（違う時だけ変える。単価も変わります）</span>
          <select
            value={workplace}
            onChange={(e) => {
              setWorkplace(e.target.value);
              // 勤務先を変えたら、その勤務先の業務内容から選び直す
              const names = taskNamesByWorkplace?.[e.target.value] ?? [];
              setCustomTaskName(false);
              if (names.length > 0 && !names.includes(taskName)) setTaskName(names.length === 1 ? names[0] : "");
            }}
            className={inputClass}
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
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <button
        type="button"
        disabled={pending || !clockIn || !clockOut}
        onClick={submit}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? "保存中…" : "保存してスタッフに確認してもらう"}
      </button>
    </div>
  );
}
