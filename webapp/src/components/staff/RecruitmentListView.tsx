"use client";

import { useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { applyToRecruitmentAction } from "@/app/staff/actions";
import { holidayName } from "@/lib/holidays";
import { todayJst } from "@/lib/date";
import { leadingBlankCount, orderedWeekdays, useMondayFirst } from "@/components/week/WeekStart";

type Row = {
  id: string;
  title: string;
  companyName: string;
  visibility: "ORDER" | "PUBLIC";
  date: string;
  startTime: string | null;
  endTime: string | null;
  isUndecided: boolean;
  note: string | null;
  announcements: string[];
  hourlyWage: number | null;
  wageType: string | null;
  extraItems: { label: string; value: string }[];
  maxEntries: number;
  filled: number;
  alreadyApplied: boolean;
  isAffiliated: boolean;
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatDateJa(dateStr: string) {
  const [, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return `${m}月${d}日（${WEEKDAYS[dow]}）`;
}

function weekdayColor(dow: number, dateStr?: string) {
  if (dow === 0 || (dateStr && holidayName(dateStr))) return "text-red-600";
  if (dow === 6) return "text-blue-600";
  return "text-foreground";
}

// 募集はカレンダーで見せる。募集のある日に件数を出し、タップするとその日の募集が
// ポップアップで開く（中身は従来どおりのカード：▼で詳細→応募する）。
// もうシフトが入っている日は薄い緑（応募するとその場でシフトになるので、応募した日も緑になる）。
export function RecruitmentListView({
  recruitments,
  shiftDates = [],
}: {
  recruitments: Row[];
  shiftDates?: string[];
}) {
  const mondayFirst = useMondayFirst();
  const today = todayJst();
  const byDate = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of recruitments) m.set(r.date, [...(m.get(r.date) ?? []), r]);
    return m;
  }, [recruitments]);
  const sortedDates = useMemo(() => [...byDate.keys()].sort(), [byDate]);
  const firstMonth = today.slice(0, 7);
  const lastMonth = [sortedDates[sortedDates.length - 1]?.slice(0, 7) ?? firstMonth, firstMonth].sort()[1];
  // 最初は、今日以降で一番近い募集のある月を出す
  const initialMonth = [sortedDates.find((d) => d >= today)?.slice(0, 7) ?? firstMonth, firstMonth].sort()[1];
  const [month, setMonth] = useState(initialMonth);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // この画面で応募した募集（ポップアップを閉じても「応募済み」のまま。その日はシフトありの緑にする）
  const [appliedIds, setAppliedIds] = useState<Record<string, boolean>>({});
  const shifts = new Set([...shiftDates, ...recruitments.filter((r) => appliedIds[r.id]).map((r) => r.date)]);

  const [y, mo] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: leadingBlankCount(y, mo, mondayFirst) }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  function shiftMonth(delta: number) {
    const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
    setMonth(d.toISOString().slice(0, 7));
  }
  const dayRows = selectedDate ? (byDate.get(selectedDate) ?? []) : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-black/5">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            aria-label="前の月"
            disabled={month <= firstMonth}
            onClick={() => shiftMonth(-1)}
            className="rounded-lg px-3 py-1 text-lg text-primary disabled:opacity-30"
          >
            ‹
          </button>
          <span className="font-serif-jp text-base font-bold text-primary" data-testid="recruitment-month">
            {y}年{mo}月
          </span>
          <button
            type="button"
            aria-label="次の月"
            disabled={month >= lastMonth}
            onClick={() => shiftMonth(1)}
            className="rounded-lg px-3 py-1 text-lg text-primary disabled:opacity-30"
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {orderedWeekdays(mondayFirst).map(({ dow, label }) => (
            <div key={label} className={`py-0.5 text-center text-[11px] font-semibold ${weekdayColor(dow)}`}>
              {label}
            </div>
          ))}
          {cells.map((dateStr, i) => {
            if (!dateStr) return <div key={i} />;
            const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
            const count = byDate.get(dateStr)?.length ?? 0;
            const past = dateStr < today;
            const hasShift = shifts.has(dateStr);
            return (
              <button
                key={i}
                type="button"
                disabled={count === 0}
                onClick={() => setSelectedDate(dateStr)}
                data-testid={`rec-day-${dateStr}`}
                data-count={count || undefined}
                data-shift={hasShift ? "true" : undefined}
                className={`flex h-14 flex-col items-center justify-start gap-0.5 rounded-lg pt-1.5 text-xs ${
                  hasShift ? "bg-emerald-100" : count > 0 ? "bg-background" : ""
                } ${dateStr === today ? "font-bold underline" : ""} ${
                  past ? "opacity-40" : ""
                }`}
              >
                <span className={weekdayColor(dow, dateStr)}>{Number(dateStr.slice(8))}</span>
                {count > 0 ? (
                  <span className="min-w-[1.25rem] rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground">
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
          <span className="flex items-center gap-1">
            <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 text-primary-foreground">2</span>募集の件数
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded bg-emerald-100" />シフトあり
          </span>
        </div>
      </div>
      {recruitments.length === 0 ? <p className="text-sm text-muted">現在募集中のシフトはありません。</p> : null}
      {selectedDate ? (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-black/30 sm:items-center sm:p-4"
          onClick={() => setSelectedDate(null)}
          data-testid="recruitment-day-popup"
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-background p-4 shadow-lg sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-serif-jp text-base font-bold text-primary">{formatDateJa(selectedDate)}の募集</p>
              <button type="button" onClick={() => setSelectedDate(null)} className="px-2 text-sm text-muted">
                閉じる
              </button>
            </div>
            {shifts.has(selectedDate) ? (
              <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">この日はもうシフトが入っています。</p>
            ) : null}
            <div className="overflow-y-auto">
              {dayRows.length === 0 ? <p className="py-4 text-center text-sm text-muted">この日の募集はもうありません。</p> : null}
              <RecruitmentCards
                recruitments={dayRows}
                applied={appliedIds}
                onApplied={(id) => setAppliedIds((prev) => ({ ...prev, [id]: true }))}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// 見出しは「日付」「募集企業名・残り人数」だけに絞り、業務内容・時間・
// 給与などの詳細は▼で開くまで隠す。応募するかどうかは詳細を見てから
// 判断するものなので、タップで展開→内容確認→応募する、という導線は
// そのまま保つ（一発ボタンでの誤応募を防ぐ）。
function RecruitmentCards({
  recruitments,
  applied,
  onApplied,
}: {
  recruitments: Row[];
  applied: Record<string, boolean>;
  onApplied: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  // 応募する前に、内容を確かめてもらう
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function apply(id: string) {
    startTransition(async () => {
      const result = await applyToRecruitmentAction(id);
      if (result.error) {
        setErrors((prev) => ({
          ...prev,
          [id]: result.error === "recruitment_full" ? "満員になりました。" : "応募できませんでした。",
        }));
      } else {
        onApplied(id);
      }
    });
  }

  return (
    <ul className="flex flex-col gap-2">
      {recruitments.map((r) => {
        const remaining = Math.max(r.maxEntries - r.filled, 0);
        const isFull = remaining <= 0;
        const isApplied = applied[r.id] || r.alreadyApplied;
        // 所属先（自社／配属済みの依頼主）が出した公開募集は、一覧には
        // 出すが詳細は開けないようにする — 公開募集の賃金は所属の無い
        // スタッフ向けのもので、契約済みの単価と違って見えると無用な
        // 不満につながるため（実際の支給額は契約単価の方が使われる）。
        const hideDetail = r.visibility === "PUBLIC" && r.isAffiliated;
        const open = !hideDetail && openId === r.id;
        const location = r.extraItems.find((i) => i.label === "勤務地")?.value;
        // 給与・その他の項目は公開募集（所属していないスタッフ向け）だけのもの。
        // 所属先の募集（オーダー）では出さない（実際の支給は契約の単価のため）
        const otherExtraItems = r.visibility === "PUBLIC" ? r.extraItems.filter((i) => i.label !== "勤務地") : [];
        return (
          <li
            key={r.id}
            data-testid={`recruitment-${r.id}`}
            className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5"
          >
            <button
              type="button"
              disabled={hideDetail}
              onClick={() => setOpenId(open ? null : r.id)}
              className="flex w-full flex-col gap-1 px-4 py-3 text-left disabled:cursor-default"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-foreground">
                  {r.visibility === "PUBLIC" ? (
                    <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
                      公開募集
                    </span>
                  ) : null}
                  <span className="truncate">{r.companyName}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                  {isApplied ? (
                    <span className="rounded-full bg-accent/20 px-2 py-0.5 text-accent">応募済み</span>
                  ) : isFull ? (
                    <span className="rounded-full bg-background px-2 py-0.5">満員</span>
                  ) : (
                    <span>残り{remaining}名</span>
                  )}
                  {hideDetail ? null : (
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                    >
                      <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
              </div>
              {location && !hideDetail ? <span className="text-xs text-muted">勤務地：{location}</span> : null}
            </button>
            {open ? (
              <div className="flex flex-col gap-2 border-t border-black/5 px-4 py-3 text-sm">
                <p>
                  <span className="mr-1 text-xs text-muted">業務内容</span>
                  {r.title}
                </p>
                <p>
                  <span className="mr-1 text-xs text-muted">時間</span>
                  {r.isUndecided || (!r.startTime && !r.endTime) ? "未定" : `${r.startTime ?? ""}〜${r.endTime ?? ""}`}
                </p>
                {r.hourlyWage && r.visibility === "PUBLIC" ? (
                  <p>
                    <span className="mr-1 text-xs text-muted">給与</span>
                    {r.wageType === "DAILY" ? "日給" : "時給"}
                    {r.hourlyWage}円
                  </p>
                ) : null}
                {otherExtraItems.map((item) => (
                  <p key={item.label}>
                    <span className="mr-1 text-xs text-muted">{item.label}</span>
                    {item.value}
                  </p>
                ))}
                {r.note ? (
                  <p className="whitespace-pre-wrap">
                    <span className="mr-1 text-xs text-muted">備考</span>
                    {r.note}
                  </p>
                ) : null}
                {r.announcements.length > 0 ? (
                  <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <p className="mb-1 font-semibold">追加のお知らせ</p>
                    {r.announcements.map((body, i) => (
                      <p key={i} className="whitespace-pre-wrap">
                        {body}
                      </p>
                    ))}
                  </div>
                ) : null}
                {errors[r.id] ? <p className="text-xs text-red-600">{errors[r.id]}</p> : null}
                <button
                  type="button"
                  disabled={pending || isFull || isApplied}
                  onClick={() => setConfirmId(r.id)}
                  className="mt-1 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {isApplied ? "応募済み" : isFull ? "満員" : "応募する"}
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
      {(() => {
        const target = recruitments.find((r) => r.id === confirmId);
        if (!target) return null;
        return createPortal(
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setConfirmId(null)}>
            <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
              <p className="mb-1 font-serif-jp text-base font-bold text-primary">この募集に応募しますか？</p>
              <p className="mb-4 text-sm text-muted">
                {formatDateJa(target.date)} {target.companyName}
                <br />
                {target.title}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmId(null)}
                  className="flex-1 rounded-lg border border-border px-4 py-2 text-sm"
                >
                  やめる
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setConfirmId(null);
                    apply(target.id);
                  }}
                  className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  応募する
                </button>
              </div>
            </div>
          </div>,
          document.body,
        );
      })()}
    </ul>
  );
}
