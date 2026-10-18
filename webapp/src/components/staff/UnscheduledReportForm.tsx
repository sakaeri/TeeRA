"use client";

import { useState, useTransition } from "react";
import { submitUnscheduledWorkReportAction } from "@/app/staff/actions";
import { todayJst } from "@/lib/date";

export type UnscheduledCompanyOption = {
  companyId: string;
  companyName: string;
  // 自社以外に選べる勤務先（本人が配属されている依頼主）
  workplaces: { companyRelationshipId: string; name: string }[];
};

// シフトが作られていないまま働いた日（緊急の出勤など）の業務報告。
// 提出すると裏でシフトが作られ、通常のシフトの業務報告と同じ承認待ちに入る。
export function UnscheduledReportButton({
  companies,
  knownTaskNamesByCompany,
}: {
  companies: UnscheduledCompanyOption[];
  knownTaskNamesByCompany: Record<string, string[]>;
}) {
  const [open, setOpen] = useState(false);
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
  onClose,
  onSubmitted,
}: {
  companies: UnscheduledCompanyOption[];
  knownTaskNamesByCompany: Record<string, string[]>;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [companyId, setCompanyId] = useState(companies[0].companyId);
  const [relationshipId, setRelationshipId] = useState("");
  const [date, setDate] = useState(todayJst());
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [taskName, setTaskName] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const company = companies.find((c) => c.companyId === companyId) ?? companies[0];
  const knownTaskNames = knownTaskNamesByCompany[companyId] ?? [];

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
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-lg"
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
                  setRelationshipId("");
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
              value={relationshipId}
              onChange={(e) => setRelationshipId(e.target.value)}
              className="rounded-lg border border-border px-3 py-2"
            >
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
          </label>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">出勤</span>
              <input
                type="time"
                value={clockIn}
                onChange={(e) => setClockIn(e.target.value)}
                className="rounded-lg border border-border px-2 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">退勤</span>
              <input
                type="time"
                value={clockOut}
                onChange={(e) => setClockOut(e.target.value)}
                className="rounded-lg border border-border px-2 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">休憩（分）</span>
              <input
                type="number"
                min="0"
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(e.target.value)}
                className="w-20 rounded-lg border border-border px-2 py-2"
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
          disabled={pending || !date || !clockIn || !clockOut}
          onClick={submit}
          className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {pending ? "提出中…" : "業務報告を提出する"}
        </button>
      </div>
    </div>
  );
}
