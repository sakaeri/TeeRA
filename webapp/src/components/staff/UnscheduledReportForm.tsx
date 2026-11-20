"use client";

import { useState, useTransition } from "react";
import { submitUnscheduledWorkReportAction } from "@/app/staff/actions";
import { todayJst } from "@/lib/date";
import { taskNamesForWorkplace } from "@/lib/workplaceTaskNames";

export type UnscheduledCompanyOption = {
  companyId: string;
  companyName: string;
  // 自社以外に選べる勤務先（本人が配属されている依頼主）と、その勤務先に登録されている業務内容
  workplaces: { companyRelationshipId: string; name: string }[];
  // 本人が最近使った業務内容（新しい順・入力候補に出す）
  recentTaskNames?: string[];
};

// シフトが作られていないまま働いた日（緊急の出勤など）の業務報告。
// 提出すると裏でシフトが作られ、通常のシフトの業務報告と同じ承認待ちに入る。
export function UnscheduledReportButton({
  companies,
  knownTaskNamesByCompany,
  taskNamesByWorkplace = {},
  initialOpen = false,
}: {
  companies: UnscheduledCompanyOption[];
  knownTaskNamesByCompany: Record<string, string[]>;
  taskNamesByWorkplace?: Record<string, string[]>;
  // カレンダーの「＋」から来た時は最初から開く
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [done, setDone] = useState(false);

  if (companies.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDone(false);
          setOpen(true);
        }}
        className="w-full rounded-2xl border border-dashed border-primary/50 bg-white/60 px-4 py-3 text-sm font-semibold text-primary"
      >
        ＋シフト外の勤務を報告する
      </button>
      {done ? <p className="text-center text-sm text-muted">シフト外の勤務を報告しました。承認されるまでお待ちください。</p> : null}
      {open ? (
        <UnscheduledReportModal
          companies={companies}
          knownTaskNamesByCompany={knownTaskNamesByCompany}
          taskNamesByWorkplace={taskNamesByWorkplace}
          onClose={() => setOpen(false)}
          onSubmitted={() => {
            setOpen(false);
            setDone(true);
          }}
        />
      ) : null}
    </>
  );
}

function UnscheduledReportModal({
  companies,
  knownTaskNamesByCompany,
  taskNamesByWorkplace,
  onClose,
  onSubmitted,
}: {
  companies: UnscheduledCompanyOption[];
  knownTaskNamesByCompany: Record<string, string[]>;
  taskNamesByWorkplace: Record<string, string[]>;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [companyId, setCompanyId] = useState(companies[0].companyId);
  // 勤務先は最初は選ばない（自社のまま出してしまうのを防ぐ）。null＝未選択、""＝自社
  const [relationshipId, setRelationshipId] = useState<string | null>(null);
  const [date, setDate] = useState(todayJst());
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [taskName, setTaskName] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const company = companies.find((c) => c.companyId === companyId) ?? companies[0];
  // 業務内容の候補は選んだ勤務先に紐付いているもの（勤務先を選ぶまでは会社全体）
  const knownTaskNames =
    relationshipId === null
      ? (knownTaskNamesByCompany[companyId] ?? [])
      : taskNamesForWorkplace(taskNamesByWorkplace, companyId, relationshipId || null);
  // 入力候補（押すと入る）：最近使った業務内容のうち、この勤務先のもの → 勤務先の業務内容
  const recent = (company.recentTaskNames ?? []).filter((n) => relationshipId === null || knownTaskNames.includes(n));
  const workplaceTaskNames = relationshipId === null ? [] : knownTaskNames;
  const suggestions = [...new Set([...recent, ...workplaceTaskNames])].slice(0, 8);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await submitUnscheduledWorkReportAction({
        companyId,
        companyRelationshipId: relationshipId || undefined,
        date,
        clockInTime: clockIn,
        clockOutTime: clockOut,
        breakMinutes: Number(breakMinutes) || 0,
        taskName: taskName.trim() || undefined,
        comment: comment.trim() || undefined,
      });
      if (result.status === "error") {
        setError(result.reason);
        return;
      }
      onSubmitted();
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="max-h-popup w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">シフト外の勤務を報告</h3>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-muted hover:text-primary">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-muted">
          急な出勤など、シフトが無いまま働いた日の報告です。提出すると勤務先の承認待ちになります。
        </p>

        <div className="flex flex-col gap-3 text-sm">
          {companies.length > 1 ? (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">所属先</span>
              <select
                value={companyId}
                onChange={(e) => {
                  setCompanyId(e.target.value);
                  setRelationshipId(null);
                  setTaskName("");
                }}
                className="rounded-lg border border-border px-3 py-2"
              >
                {companies.map((c) => (
                  <option key={c.companyId} value={c.companyId}>
                    {c.companyName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">勤務先</span>
            <select
              value={relationshipId ?? "__none"}
              onChange={(e) => setRelationshipId(e.target.value === "__none" ? null : e.target.value)}
              className={`rounded-lg border border-border px-3 py-2 ${relationshipId === null ? "text-muted" : ""}`}
              data-testid="unscheduled-workplace"
            >
              {relationshipId === null ? <option value="__none">選んでください</option> : null}
              <option value="">自社（{company.companyName}）</option>
              {company.workplaces.map((w) => (
                <option key={w.companyRelationshipId} value={w.companyRelationshipId}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">勤務日</span>
            <input
              type="date"
              value={date}
              max={todayJst()}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-border px-3 py-2"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">業務内容</span>
            <input
              type="text"
              list="unscheduled-task-names"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="例：倉庫での軽作業"
              className="rounded-lg border border-border px-3 py-2"
            />
            <datalist id="unscheduled-task-names">
              {knownTaskNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {suggestions.length > 0 ? (
              <span className="flex flex-wrap gap-1.5" data-testid="task-suggestions">
                {suggestions.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setTaskName(name)}
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      taskName === name ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-foreground"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </span>
            ) : null}
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">出勤</span>
              <input
                type="time"
                value={clockIn}
                onChange={(e) => setClockIn(e.target.value)}
                className="w-full rounded-lg border border-border px-2 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">退勤</span>
              <input
                type="time"
                value={clockOut}
                onChange={(e) => setClockOut(e.target.value)}
                className="w-full rounded-lg border border-border px-2 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">休憩（分）</span>
              <input
                type="number"
                min="0"
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(e.target.value)}
                className="w-full rounded-lg border border-border px-2 py-2"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">コメント（任意）</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="例：急な欠員のため呼ばれて出勤しました"
              className="rounded-lg border border-border px-3 py-2"
            />
          </label>
        </div>

        {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
        <button
          type="button"
          disabled={pending || relationshipId === null || !date || !clockIn || !clockOut}
          onClick={submit}
          className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {pending ? "提出中…" : "業務報告を提出する"}
        </button>
      </div>
    </div>
  );
}
