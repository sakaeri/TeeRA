"use client";

import { leadingBlankCount, orderedWeekdays, useMondayFirst } from "@/components/week/WeekStart";
import Link from "next/link";

// シフト希望を「箇条書きの日付」ではなく、月のカレンダーで見せるための部品。
// （管理側から「希望日が箇条書きで分かりにくい」という声があったため）

function monthCells(year: number, month: number, mondayFirst: boolean) {
  const startDow = leadingBlankCount(year, month, mondayFirst);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: startDow }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  return cells;
}

function weekdayClass(i: number) {
  return i === 0 ? "text-red-600" : i === 6 ? "text-blue-600" : "text-muted";
}

// 1件の申請で出した日を、月ごとの小さなカレンダーで示す（希望の日に色。押すとその日のカレンダーへ）
// tone="off" は休み希望の申請（希望の日を薄い赤で）。offDates は出勤希望のカードに、そのスタッフの休み希望の日を薄い赤で添える
export function RequestDatesCalendar({
  dates,
  hrefFor,
  tone = "work",
  offDates = [],
  shiftDates = [],
}: {
  dates: string[];
  hrefFor: (date: string) => string;
  tone?: "work" | "off";
  offDates?: string[];
  // そのスタッフのシフトを作成済みの日（薄い緑の塗り）
  shiftDates?: string[];
}) {
  const set = new Set(dates);
  const offSet = new Set(offDates);
  const shiftSet = new Set(shiftDates);
  // 色分け：出勤希望＝青枠、休み希望＝赤枠、シフト作成済み＝薄い緑の塗り（枠と塗りは重なる）
  const cellClass = (d: string) => {
    const ring = set.has(d)
      ? tone === "off"
        ? "ring-2 ring-inset ring-red-400"
        : "ring-2 ring-inset ring-blue-400"
      : offSet.has(d)
        ? "ring-2 ring-inset ring-red-400"
        : "";
    const fill = shiftSet.has(d) ? "bg-green-100 text-green-900" : "";
    return `${ring} ${fill}`;
  };
  const mondayFirst = useMondayFirst();
  const months = [...new Set([...dates, ...offDates].map((d) => d.slice(0, 7)))].sort();
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
              {orderedWeekdays(mondayFirst).map(({ dow, label }) => (
                <span key={label} className={weekdayClass(dow)}>
                  {label}
                </span>
              ))}
              {monthCells(y, m, mondayFirst).map((d, i) =>
                d === null ? (
                  <span key={i} />
                ) : set.has(d) ? (
                  <Link
                    key={d}
                    href={hrefFor(d)}
                    className={`rounded py-0.5 font-semibold hover:bg-background ${cellClass(d)}`}
                    data-requested="true"
                    data-shift={shiftSet.has(d) ? "true" : undefined}
                  >
                    {Number(d.slice(8, 10))}
                  </Link>
                ) : offSet.has(d) || shiftSet.has(d) ? (
                  <span
                    key={d}
                    className={`rounded py-0.5 ${cellClass(d)}`}
                    data-off={offSet.has(d) ? "true" : undefined}
                    data-shift={shiftSet.has(d) ? "true" : undefined}
                  >
                    {Number(d.slice(8, 10))}
                  </span>
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
