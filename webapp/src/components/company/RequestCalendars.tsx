"use client";

import Link from "next/link";

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
    <div className="flex flex-wrap justify-center gap-3" data-testid="request-dates-calendar">
      {months.map((ym) => {
        const [y, m] = ym.split("-").map(Number);
        return (
          <div key={ym} className="min-w-[13.5rem] max-w-[20rem] flex-1 rounded-lg border border-border/70 bg-white p-2">
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
