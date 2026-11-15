"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

// シフト希望を「箇条書きの日付」ではなく、月のカレンダーで見せるための部品。
// （管理側から「希望日が箇条書きで分かりにくい」という声があったため）

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function monthCells(year: number, month: number) {
  const startDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: startDow }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  return cells;
}

function weekdayClass(i: number) {
  return i === 0 ? "text-red-600" : i === 6 ? "text-blue-600" : "text-muted";
}

// 1件の申請で出した日を、月ごとの小さなカレンダーで示す（希望の日に色。押すとその日のカレンダーへ）
export function RequestDatesCalendar({ dates, hrefFor }: { dates: string[]; hrefFor: (date: string) => string }) {
  const set = new Set(dates);
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))].sort();
  return (
    <div className="flex flex-wrap gap-3" data-testid="request-dates-calendar">
      {months.map((ym) => {
        const [y, m] = ym.split("-").map(Number);
        return (
          <div key={ym} className="w-[13.5rem] rounded-lg border border-border/70 bg-white p-2">
            <p className="mb-1 text-center text-xs font-semibold">
              {y}年{m}月
            </p>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[10px]">
              {WEEKDAYS.map((w, i) => (
                <span key={w} className={weekdayClass(i)}>
                  {w}
                </span>
              ))}
              {monthCells(y, m).map((d, i) =>
                d === null ? (
                  <span key={i} />
                ) : set.has(d) ? (
                  <Link
                    key={d}
                    href={hrefFor(d)}
                    className="rounded bg-orange-200 py-0.5 font-semibold text-orange-900 hover:bg-orange-300"
                    data-requested="true"
                  >
                    {Number(d.slice(8, 10))}
                  </Link>
                ) : (
                  <span key={d} className="py-0.5 text-foreground/40">
                    {Number(d.slice(8, 10))}
                  </span>
                ),
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 日ごとの希望の人数を月のカレンダーで示す（人数の多い日ほど濃く。押すとその日の詳細）。過ぎた日は出さない
export function RequestCountCalendar({
  countsByDate,
  todayStr,
  onSelect,
}: {
  countsByDate: Map<string, number>;
  todayStr: string;
  onSelect: (date: string) => void;
}) {
  const firstMonth = useMemo(() => {
    const first = [...countsByDate.keys()].sort()[0] ?? todayStr;
    return first.slice(0, 7);
  }, [countsByDate, todayStr]);
  const [ym, setYm] = useState(firstMonth);
  const [y, m] = ym.split("-").map(Number);
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setYm(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const max = Math.max(1, ...countsByDate.values());
  const monthTotal = [...countsByDate.entries()].filter(([d]) => d.startsWith(ym)).reduce((s, [, c]) => s + c, 0);

  return (
    <div data-testid="request-count-calendar">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shift(-1)}
          disabled={ym <= todayStr.slice(0, 7)}
          aria-label="前の月"
          className="rounded-full p-1.5 text-muted hover:text-primary disabled:opacity-30"
        >
          ‹
        </button>
        <p className="text-sm font-semibold">
          {y}年{m}月<span className="ml-2 text-xs font-normal text-muted">{monthTotal}件</span>
        </p>
        <button type="button" onClick={() => shift(1)} aria-label="次の月" className="rounded-full p-1.5 text-muted hover:text-primary">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={`text-[11px] font-semibold ${weekdayClass(i)}`}>
            {w}
          </span>
        ))}
        {monthCells(y, m).map((d, i) => {
          if (d === null) return <span key={i} />;
          const count = d >= todayStr ? (countsByDate.get(d) ?? 0) : 0;
          const day = Number(d.slice(8, 10));
          if (count === 0) {
            return (
              <span key={d} className={`rounded-lg py-1.5 text-xs ${d < todayStr ? "text-muted/40" : "text-foreground/60"}`}>
                {day}
              </span>
            );
          }
          const strong = count / max >= 0.67;
          const mid = count / max >= 0.34;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onSelect(d)}
              data-count={count}
              className={`flex flex-col items-center rounded-lg py-1 text-xs ring-1 ring-orange-300 ${
                strong ? "bg-orange-300 text-orange-950" : mid ? "bg-orange-200 text-orange-900" : "bg-orange-100 text-orange-900"
              }`}
            >
              <span className="font-semibold">{day}</span>
              <span className="text-[10px] font-semibold">{count}名</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
