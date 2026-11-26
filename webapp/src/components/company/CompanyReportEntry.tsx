"use client";

import { useEffect, useState, useTransition } from "react";
import {
  addPastWorkByCompanyAction,
  enterWorkReportByCompanyAction,
  enterWorkReportsByCompanyAction,
  getCompanyEntryOptionsAction,
  getPastWorkOptionsAction,
} from "@/app/company/workreports/companyEntryActions";
import { todayJst } from "@/lib/date";

const inputClass = "w-full rounded-lg border border-border bg-white px-2 py-2 text-sm text-foreground";
const NEW_TASK = "__new__";

function TaskPicker({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  const [custom, setCustom] = useState(options.length === 0);
  if (custom) {
    return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="業務内容を入力" className={inputClass} />;
  }
  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === NEW_TASK) {
          setCustom(true);
          onChange("");
        } else onChange(e.target.value);
      }}
      className={inputClass}
    >
      <option value="">未選択</option>
      {value && !options.includes(value) ? <option value={value}>{value}</option> : null}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      <option value={NEW_TASK}>＋ 新しい業務内容</option>
    </select>
  );
}

// 業務報告の詳細：スタッフがまだ出していない勤務を、会社が代わりに入力する（入力と同時に承認済み）
export function CompanyReportEntryForm({ shiftId, staffIsProxy, onDone }: { shiftId: string; staffIsProxy: boolean; onDone: (message: string) => void }) {
  const [opts, setOpts] = useState<Awaited<ReturnType<typeof getCompanyEntryOptionsAction>> | null>(null);
  const [outcome, setOutcome] = useState<"WORKED" | "ABSENT" | "CANCELLED_BY_EMPLOYER">("WORKED");
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [taskName, setTaskName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getCompanyEntryOptionsAction(shiftId)
      .then((o) => {
        if (cancelled) return;
        setOpts(o);
        setClockIn(o.startTime ?? "");
        setClockOut(o.endTime ?? "");
        setTaskName(o.taskName ?? (o.taskOptions.length === 1 ? o.taskOptions[0] : ""));
      })
      .catch(() => {
        if (!cancelled) setError("読み込めませんでした。");
      });
    return () => {
      cancelled = true;
    };
  }, [shiftId]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await enterWorkReportByCompanyAction(shiftId, {
        outcome,
        clockIn,
        clockOut,
        breakMinutes: Number(breakMinutes) || 0,
        taskName,
      });
      if (result.status === "error") {
        setError(result.reason);
        return;
      }
      onDone(result.approved ? "会社が入力して、承認済みにしました。" : "会社が入力しました。依頼主の承認を待っています。");
    });
  }

  if (!opts) return <p className="text-xs text-muted">{error ?? "読み込み中…"}</p>;
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-primary/30 bg-white p-3" data-testid="company-entry-form">
      <p className="text-xs text-muted">
        スタッフの代わりに入力します。入力するとそのまま承認済みになり、給料明細・請求書に入ります。
        {staffIsProxy ? "" : "スタッフにはお知らせが届きます。"}
      </p>
      <div className="flex gap-1.5 text-xs" role="radiogroup" aria-label="結果">
        {(
          [
            ["WORKED", "出勤"],
            ["ABSENT", "欠勤"],
            ["CANCELLED_BY_EMPLOYER", "勤務先キャンセル"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={outcome === v}
            onClick={() => setOutcome(v)}
            className={`flex-1 rounded-lg border px-2 py-1.5 font-semibold ${outcome === v ? "border-primary bg-primary text-primary-foreground" : "border-border bg-white"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {outcome === "WORKED" ? (
        <>
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
              <input type="number" min="0" value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} className={inputClass} />
            </label>
            <label className="flex min-w-0 flex-col gap-0.5 text-xs">
              <span className="text-muted">業務内容</span>
              <TaskPicker value={taskName} options={opts.taskOptions} onChange={setTaskName} />
            </label>
          </div>
        </>
      ) : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <button
        type="button"
        disabled={pending || (outcome === "WORKED" && (!clockIn || !clockOut))}
        onClick={submit}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? "入力中…" : "入力して承認済みにする"}
      </button>
    </div>
  );
}

type UnsubmittedDay = { shiftId: string; date: string; startTime: string | null; endTime: string | null; workplaceLabel: string; taskName: string | null };

// スタッフ詳細：未提出の勤務をまとめて入力する（過去分の取り込み用）。時刻はシフトの予定時刻を入れておく
export function BulkCompanyEntryModal({ days, onClose, onDone }: { days: UnsubmittedDay[]; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState(
    days.map((d) => ({ ...d, checked: Boolean(d.startTime && d.endTime), clockIn: d.startTime ?? "", clockOut: d.endTime ?? "", breakMinutes: "0" })),
  );
  const [result, setResult] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const chosen = rows.filter((r) => r.checked && r.clockIn && r.clockOut);
  const update = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function submit() {
    startTransition(async () => {
      const res = await enterWorkReportsByCompanyAction(
        chosen.map((r) => ({
          shiftId: r.shiftId,
          input: { outcome: "WORKED" as const, clockIn: r.clockIn, clockOut: r.clockOut, breakMinutes: Number(r.breakMinutes) || 0, taskName: r.taskName },
        })),
      );
      const ok = chosen.length - res.failed.length;
      setResult(
        `${ok}件を入力しました。${res.pendingClient > 0 ? `（うち${res.pendingClient}件は依頼主の承認待ち）` : ""}${
          res.failed.length > 0 ? `入力できなかった日：${res.failed.map((f) => `${rows.find((r) => r.shiftId === f.shiftId)?.date.slice(5)}（${f.reason}）`).join("、")}` : ""
        }`,
      );
      setRows((rs) => rs.filter((r) => !chosen.some((c) => c.shiftId === r.shiftId) || res.failed.some((f) => f.shiftId === r.shiftId)));
      onDone();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div role="dialog" aria-label="未提出の勤務をまとめて入力" className="max-h-popup w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()} data-testid="bulk-entry-modal">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">未提出の勤務をまとめて入力</h3>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-muted hover:text-primary">✕</button>
        </div>
        <p className="mb-3 text-xs text-muted">✅を付けた勤務を「出勤」として入力し、そのまま承認済みにします。時刻はシフトの予定時刻を入れてあります。違う日だけ直してください。</p>
        {result ? <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900" data-testid="bulk-entry-result">{result}</p> : null}
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">未提出の勤務はありません。</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60 text-xs">
            {rows.map((r, i) => (
              <li key={r.shiftId} className="flex flex-col gap-1.5 py-2" data-testid="bulk-entry-row">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={r.checked} onChange={(e) => update(i, { checked: e.target.checked })} />
                  <span className="font-semibold">{r.date.slice(5).replace("-", "/")}</span>
                  <span className="min-w-0 truncate text-muted">{r.workplaceLabel}{r.taskName ? `・${r.taskName}` : ""}</span>
                </label>
                <div className="grid grid-cols-[1fr_1fr_4.5rem] gap-1.5 pl-6">
                  <input type="time" value={r.clockIn} onChange={(e) => update(i, { clockIn: e.target.value })} aria-label="出勤時刻" className={inputClass} />
                  <input type="time" value={r.clockOut} onChange={(e) => update(i, { clockOut: e.target.value })} aria-label="退勤時刻" className={inputClass} />
                  <input type="number" min="0" value={r.breakMinutes} onChange={(e) => update(i, { breakMinutes: e.target.value })} aria-label="休憩（分）" placeholder="休憩" className={inputClass} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {rows.length > 0 ? (
          <button type="button" disabled={pending || chosen.length === 0} onClick={submit} className="mt-3 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {pending ? "入力中…" : `✅の${chosen.length}件を入力して承認済みにする`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// スタッフ詳細：シフトが無い過去の勤務を追加する（シフトと承認済みの業務報告を一度に作る）
export function PastWorkModal({ staffUserId, onClose, onDone }: { staffUserId: string; onClose: () => void; onDone: () => void }) {
  const [opts, setOpts] = useState<Awaited<ReturnType<typeof getPastWorkOptionsAction>> | null>(null);
  const [date, setDate] = useState("");
  const [workplace, setWorkplace] = useState("");
  const [taskName, setTaskName] = useState("");
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getPastWorkOptionsAction(staffUserId)
      .then((o) => {
        if (!cancelled) setOpts(o);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [staffUserId]);

  const taskOptions = opts?.taskNamesByWorkplace[workplace] ?? [];
  function submit() {
    setMessage(null);
    startTransition(async () => {
      const r = await addPastWorkByCompanyAction({
        staffUserId,
        date,
        companyRelationshipId: workplace || null,
        taskName: taskName || null,
        clockIn,
        clockOut,
        breakMinutes: Number(breakMinutes) || 0,
      });
      if (r.status === "error") {
        setMessage({ ok: false, text: r.reason });
        return;
      }
      setMessage({ ok: true, text: `${date.slice(5).replace("-", "/")}の勤務を追加しました。${r.approved ? "" : "（依頼主の承認待ち）"}続けて追加できます。` });
      setDate("");
      onDone();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div role="dialog" aria-label="過去の勤務を追加" className="max-h-popup w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()} data-testid="past-work-modal">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">過去の勤務を追加</h3>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-muted hover:text-primary">✕</button>
        </div>
        <p className="mb-3 text-xs text-muted">シフトが無い日の勤務を追加します。追加するとそのまま承認済みになり、給料明細・請求書に入ります。</p>
        {!opts ? (
          <p className="py-4 text-center text-sm text-muted">読み込み中…</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="text-muted">日付</span>
              <input type="date" value={date} max={todayJst()} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="text-muted">勤務先</span>
              <select
                value={workplace}
                onChange={(e) => {
                  setWorkplace(e.target.value);
                  const names = opts.taskNamesByWorkplace[e.target.value] ?? [];
                  setTaskName(names.length === 1 ? names[0] : "");
                }}
                className={inputClass}
              >
                {opts.workplaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-xs">
              <span className="text-muted">業務内容</span>
              <TaskPicker key={workplace} value={taskName} options={taskOptions} onChange={setTaskName} />
            </label>
            <div className="grid grid-cols-[1fr_1fr_4.5rem] gap-2">
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-muted">出勤</span>
                <input type="time" value={clockIn} onChange={(e) => setClockIn(e.target.value)} className={inputClass} />
              </label>
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-muted">退勤</span>
                <input type="time" value={clockOut} onChange={(e) => setClockOut(e.target.value)} className={inputClass} />
              </label>
              <label className="flex flex-col gap-0.5 text-xs">
                <span className="text-muted">休憩(分)</span>
                <input type="number" min="0" value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} className={inputClass} />
              </label>
            </div>
            {message ? <p className={`text-xs ${message.ok ? "text-emerald-700" : "text-red-600"}`} data-testid="past-work-message">{message.text}</p> : null}
            <button type="button" disabled={pending || !date || !clockIn || !clockOut} onClick={submit} className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {pending ? "追加中…" : "追加して承認済みにする"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
