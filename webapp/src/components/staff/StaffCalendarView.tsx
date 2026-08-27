"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { submitShiftRequestAction } from "@/app/staff/actions";
import { todayJst } from "@/lib/date";

type ShiftRow = {
  id: string;
  date: string;
  companyName: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  isUndecided: boolean;
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function weekdayColor(dow: number) {
  if (dow === 0) return "text-red-600";
  if (dow === 6) return "text-blue-600";
  return "text-foreground";
}

export function StaffCalendarView({
  year,
  month,
  shifts,
}: {
  year: number;
  month: number;
  shifts: ShiftRow[];
}) {
  const [showWizard, setShowWizard] = useState(false);
  const todayStr = todayJst();

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, ShiftRow[]>();
    for (const s of shifts) {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
    }
    return map;
  }, [shifts]);

  const cells = useMemo(() => {
    const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
    const startDow = firstOfMonth.getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const out: { dateStr: string | null; day: number | null }[] = [];
    for (let i = 0; i < startDow; i++) out.push({ dateStr: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      out.push({ dateStr, day: d });
    }
    return out;
  }, [year, month]);

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const CONFIRMED_SLOT_BUDGET = 5;

  return (
    <div className="rounded-2xl bg-white p-4">
      <div className="mb-2 flex items-center justify-center gap-2">
        <Link
          href={`?y=${prev.y}&m=${prev.m}`}
          aria-label="前の月"
          className="rounded-full p-2 text-muted hover:bg-background hover:text-primary"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <Link
          href={`?y=${todayStr.slice(0, 4)}&m=${Number(todayStr.slice(5, 7))}`}
          className="rounded-lg px-2 py-1 font-serif-jp text-lg font-bold hover:bg-background"
        >
          {year}年{month}月
        </Link>
        <Link
          href={`?y=${next.y}&m=${next.m}`}
          aria-label="次の月"
          className="rounded-full p-2 text-muted hover:bg-background hover:text-primary"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`py-1 text-center text-xs font-semibold ${weekdayColor(i)}`}>
            {w}
          </div>
        ))}
        {cells.map((c, i) => {
          if (!c.dateStr) {
            return <div key={i} className="h-[100px]" />;
          }
          const dow = new Date(c.dateStr + "T00:00:00Z").getUTCDay();
          const dayShifts = shiftsByDate.get(c.dateStr) ?? [];
          const isToday = c.dateStr === todayStr;
          const visibleShifts = dayShifts.slice(0, CONFIRMED_SLOT_BUDGET);
          const hasOverflow = dayShifts.length > CONFIRMED_SLOT_BUDGET;
          return (
            <div
              key={i}
              className={`relative flex h-[100px] flex-col items-stretch justify-start overflow-hidden rounded-xl rounded-tr-none p-1.5 ${
                isToday ? "bg-accent/25" : "bg-white/40"
              }`}
            >
              <span className={`block text-center text-[11px] font-semibold ${weekdayColor(dow)}`}>{c.day}</span>
              {hasOverflow ? (
                <span
                  title={`他${dayShifts.length - CONFIRMED_SLOT_BUDGET}件`}
                  className="absolute right-0 top-0 h-0 w-0 border-r-[14px] border-b-[14px] border-r-accent border-b-transparent"
                />
              ) : null}
              <div className="mt-px flex flex-col gap-[2px]">
                {visibleShifts.map((s) => (
                  <span
                    key={s.id}
                    className="truncate rounded-full bg-emerald-100 px-1.5 py-px text-[8px] font-medium leading-tight text-emerald-900"
                  >
                    {s.companyName} {s.isAllDay ? "終日" : s.isUndecided ? "未定" : s.startTime}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setShowWizard(true)}
        className="fixed bottom-8 right-8 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl text-primary-foreground shadow-lg"
      >
        ＋
      </button>

      {showWizard ? <ApplyWizard onClose={() => setShowWizard(false)} /> : null}
    </div>
  );
}

function ApplyWizard({ onClose }: { onClose: () => void }) {
  const [desire, setDesire] = useState<"WORK" | "OFF">("WORK");
  const [dateInput, setDateInput] = useState("");
  const [dates, setDates] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function addDate() {
    if (dateInput && !dates.includes(dateInput)) {
      setDates([...dates, dateInput].sort());
      setDateInput("");
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">シフト希望申請</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>

        <div className="mb-3 flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => setDesire("WORK")}
            className={`flex-1 rounded-lg border px-3 py-2 ${
              desire === "WORK" ? "border-primary bg-primary/10 text-primary" : "border-border"
            }`}
          >
            出勤希望
          </button>
          <button
            type="button"
            onClick={() => setDesire("OFF")}
            className={`flex-1 rounded-lg border px-3 py-2 ${
              desire === "OFF" ? "border-primary bg-primary/10 text-primary" : "border-border"
            }`}
          >
            休み希望
          </button>
        </div>

        <div className="mb-3 flex gap-2">
          <input
            type="date"
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
            className="flex-1 rounded-lg border border-border px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={addDate}
            className="rounded-lg border border-primary px-3 py-2 text-sm text-primary"
          >
            追加
          </button>
        </div>
        {dates.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-1">
            {dates.map((d) => (
              <span
                key={d}
                className="rounded-full bg-accent/20 px-3 py-1 text-xs text-accent"
              >
                {d}
              </span>
            ))}
          </div>
        ) : null}

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="備考（任意）"
          className="mb-4 w-full rounded-lg border border-border px-3 py-2 text-sm"
          rows={3}
        />

        <button
          type="button"
          disabled={pending || dates.length === 0}
          onClick={() =>
            startTransition(async () => {
              await submitShiftRequestAction({ desire, dates, note: note || undefined });
              onClose();
            })
          }
          className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          申請する
        </button>
      </div>
    </div>
  );
}
