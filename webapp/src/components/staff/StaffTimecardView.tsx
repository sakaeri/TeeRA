"use client";

import { useState, useTransition } from "react";
import {
  clockInAction,
  clockOutAction,
  submitWorkReportAction,
  confirmCorrectedWorkReportAction,
} from "@/app/staff/actions";
import { isDone, type ShiftRow } from "@/lib/staffShiftStatus";

export type { ShiftRow };
export { isDone };

const APPROVAL_LABEL: Record<string, string> = {
  PENDING: "承認待ち",
  APPROVED: "承認済み",
  REJECTED: "差し戻し",
  NEEDS_CONFIRMATION: "要確認",
};

const NEW_TASK_NAME_SENTINEL = "__new__";

// 労基法の目安（6時間超で45分、8時間超で60分）を踏まえたよくある休憩時間
// をボタンで即選択できるようにする — 手入力欄は細かい調整用に残す。
const BREAK_MINUTE_PRESETS = [0, 30, 45, 60, 90];

export function StaffTimecardView({
  shifts,
  knownTaskNamesByCompany,
}: {
  shifts: ShiftRow[];
  knownTaskNamesByCompany: Record<string, string[]>;
}) {
  const actionable = shifts.filter((s) => !isDone(s));
  const done = shifts.filter(isDone);

  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col gap-4">
        {actionable.map((s) => (
          <ShiftCard key={s.id} shift={s} knownTaskNames={knownTaskNamesByCompany[s.companyId] ?? []} />
        ))}
        {shifts.length === 0 ? (
          <p className="text-sm text-muted">対象のシフトがありません。</p>
        ) : null}
        {shifts.length > 0 && actionable.length === 0 ? (
          <p className="text-sm text-muted">対応が必要な報告はありません。</p>
        ) : null}
      </ul>

      {done.length > 0 ? (
        <details className="rounded-xl border border-border/60 bg-white/40 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-muted">
            過去の報告（{done.length}件）
          </summary>
          <ul className="mt-3 flex flex-col gap-4">
            {done.map((s) => (
              <ShiftCard key={s.id} shift={s} knownTaskNames={knownTaskNamesByCompany[s.companyId] ?? []} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function ShiftCard({ shift, knownTaskNames }: { shift: ShiftRow; knownTaskNames: string[] }) {
  const [pending, startTransition] = useTransition();
  const [comment, setComment] = useState("");
  const [taskName, setTaskName] = useState(shift.taskName ?? "");
  const [taskNameMode, setTaskNameMode] = useState<"pick" | "custom">(
    knownTaskNames.length > 0 ? "pick" : "custom",
  );
  const [error, setError] = useState<string | null>(null);
  const [breakMinutes, setBreakMinutes] = useState("0");

  const finalized = shift.outcome && shift.outcome !== "WORKED";
  const readyToSubmit = shift.clockIn && shift.clockOut;
  // 休憩を確定させる前の実働時間プレビュー — サーバー側のcomputedMinutes
  // は退勤時点では休憩0分のままなので、入力中の休憩分数を反映してここで
  // 再計算する（実際の値は提出時にサーバー側で確定する）。
  const liveComputedMinutes =
    shift.clockIn && shift.clockOut
      ? Math.max(
          Math.round((new Date(shift.clockOut).getTime() - new Date(shift.clockIn).getTime()) / 60000) -
            (Number(breakMinutes) || 0),
          0,
        )
      : 0;
  // 提出済み（差し戻し以外）は編集フォームを出さず、読み取り専用の
  // 報告内容にする。承認済みかどうかは上のバッジで分かるので、ここでは
  // 「何を報告したか」だけ分かれば十分（差し戻し=REJECTEDだけは修正して
  // 再提出できるよう、下の編集フォームのまま残す）。isDone()の判定と揃えている。
  const submitted =
    shift.outcome === "WORKED" &&
    Boolean(shift.submittedAt) &&
    (shift.approvalStatus === "PENDING" || shift.approvalStatus === "APPROVED");

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
      {shift.workplaceName ? <p className="mb-2 text-sm text-muted">勤務先：{shift.workplaceName}</p> : null}

      {shift.approvalStatus === "NEEDS_CONFIRMATION" ? (
        <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent/10 p-3">
          <p className="text-sm">
            企業が打刻内容を修正しました。内容を確認してください。
          </p>
          <p className="text-sm text-muted">
            {shift.clockInTime ?? "--:--"}〜{shift.clockOutTime ?? "--:--"}（休憩{shift.breakMinutes}分／実働{" "}
            {(shift.computedMinutes / 60).toFixed(1)} 時間）
          </p>
          <button
            type="button"
            disabled={pending || !shift.workReportId}
            onClick={() => {
              if (!shift.workReportId) return;
              startTransition(() => confirmCorrectedWorkReportAction(shift.workReportId!));
            }}
            className="self-start rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            これで合っています
          </button>
        </div>
      ) : finalized ? (
        <p className="text-sm text-muted">
          {shift.outcome === "ABSENT" ? "欠勤として報告済みです。" : "勤務先からのキャンセルとして報告済みです。"}
        </p>
      ) : submitted ? (
        <p className="text-sm text-muted">
          業務報告を提出済みです。{shift.taskName ? `（${shift.taskName}／` : "（"}
          実働 {(shift.computedMinutes / 60).toFixed(1)} 時間）
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
              <div>
                <p className="mb-1 text-xs text-muted">休憩時間</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {BREAK_MINUTE_PRESETS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setBreakMinutes(String(m))}
                      className={`rounded-full border px-2.5 py-1 text-xs ${
                        Number(breakMinutes) === m
                          ? "border-primary bg-primary/10 font-semibold text-primary"
                          : "border-border text-foreground"
                      }`}
                    >
                      {m}分
                    </button>
                  ))}
                  <input
                    type="number"
                    min="0"
                    value={breakMinutes}
                    onChange={(e) => setBreakMinutes(e.target.value)}
                    className="w-16 rounded-lg border border-border px-2 py-1 text-xs"
                  />
                  <span className="text-xs text-muted">分</span>
                </div>
              </div>
              <p className="text-sm text-muted">実働 {(liveComputedMinutes / 60).toFixed(1)} 時間</p>
              <label className="flex flex-col gap-0.5 text-xs text-muted">
                業務内容
                {taskNameMode === "pick" ? (
                  <select
                    value={taskName}
                    onChange={(e) => {
                      if (e.target.value === NEW_TASK_NAME_SENTINEL) {
                        setTaskNameMode("custom");
                        setTaskName("");
                      } else {
                        setTaskName(e.target.value);
                      }
                    }}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <option value="">未選択</option>
                    {knownTaskNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                    <option value={NEW_TASK_NAME_SENTINEL}>＋ 新しい業務内容を追加する</option>
                  </select>
                ) : (
                  <div className="flex flex-col gap-1">
                    <input
                      type="text"
                      value={taskName}
                      onChange={(e) => setTaskName(e.target.value)}
                      placeholder="業務内容（例：キャディ業務）"
                      className="rounded-lg border border-border px-3 py-2 text-sm"
                    />
                    {knownTaskNames.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setTaskNameMode("pick");
                          setTaskName(shift.taskName ?? "");
                        }}
                        className="self-start text-xs text-muted hover:text-primary"
                      >
                        ← 既存の業務内容から選ぶ
                      </button>
                    ) : null}
                  </div>
                )}
              </label>
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
                        taskName: taskName.trim() || undefined,
                        breakMinutes: Number(breakMinutes) || 0,
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
