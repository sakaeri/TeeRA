"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { submitShiftRequestAction } from "@/app/staff/actions";
import { todayJst, nowJstHHMM } from "@/lib/date";

type ShiftRow = {
  id: string;
  date: string;
  companyId: string;
  companyName: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  isUndecided: boolean;
  approvalStatus: string | null;
  taskName: string | null;
};

type PendingRequestRow = {
  id: string;
  date: string;
  companyId: string;
  companyName: string;
  desire: "WORK" | "OFF";
};

type Company = { id: string; name: string };

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function weekdayColor(dow: number) {
  if (dow === 0) return "text-red-600";
  if (dow === 6) return "text-blue-600";
  return "text-foreground";
}

// 日セルの狭い枠に会社名を出すための短縮 — 「株式会社」等の法人格は前株
// でも後株でも付くうえ、ほとんどの会社名の頭に来るため、単純に先頭5文字
// を切ると「株式会社◯」ばかりになって見分けが付かない。法人格を先に
// 取り除いてから5文字に切ることで、識別に効く部分を優先して表示する。
const CORPORATE_LABELS = [
  "株式会社",
  "有限会社",
  "合同会社",
  "合資会社",
  "合名会社",
  "一般社団法人",
  "一般財団法人",
  "医療法人",
  "社会福祉法人",
  "学校法人",
];

function shortCompanyName(name: string) {
  let stripped = name;
  for (const label of CORPORATE_LABELS) {
    if (stripped.startsWith(label)) {
      stripped = stripped.slice(label.length);
      break;
    }
    if (stripped.endsWith(label)) {
      stripped = stripped.slice(0, -label.length);
      break;
    }
  }
  stripped = stripped.trim();
  return (stripped || name).slice(0, 5);
}

// 「未報告」の赤丸は、業務時間を過ぎてから初めて意味を持つ警告 —
// 未来日やまだ終了時刻前の当日シフトを「未報告」扱いにすると、単なる
// ノイズになる（会社画面のCalendarView.tsxと同じ考え方）。
function isReportOverdue(s: ShiftRow) {
  if (s.approvalStatus) return false;
  const todayStr = todayJst();
  if (s.date > todayStr) return false;
  if (s.date < todayStr) return true;
  if (s.isAllDay || s.isUndecided || !s.endTime) return false;
  return nowJstHHMM() >= s.endTime;
}

function buildMonthCells(year: number, month: number) {
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
}

export function StaffCalendarView({
  year,
  month,
  companies,
  shifts,
  pendingRequests,
}: {
  year: number;
  month: number;
  companies: Company[];
  shifts: ShiftRow[];
  pendingRequests: PendingRequestRow[];
}) {
  const [showWizard, setShowWizard] = useState(false);
  const [wizardInitialDate, setWizardInitialDate] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [companyFilter, setCompanyFilter] = useState("");
  const todayStr = todayJst();

  const filteredShifts = companyFilter ? shifts.filter((s) => s.companyId === companyFilter) : shifts;
  const filteredRequests = companyFilter
    ? pendingRequests.filter((r) => r.companyId === companyFilter)
    : pendingRequests;

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, ShiftRow[]>();
    for (const s of filteredShifts) {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
    }
    return map;
  }, [filteredShifts]);

  const requestsByDate = useMemo(() => {
    const map = new Map<string, PendingRequestRow[]>();
    for (const r of filteredRequests) {
      if (!map.has(r.date)) map.set(r.date, []);
      map.get(r.date)!.push(r);
    }
    return map;
  }, [filteredRequests]);

  const cells = useMemo(() => buildMonthCells(year, month), [year, month]);

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const CONFIRMED_SLOT_BUDGET = 5;

  return (
    <div className="rounded-2xl bg-white p-1.5 sm:p-4">
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

      {companies.length > 1 ? (
        <div className="mb-2 flex items-center justify-center gap-1.5 sm:mb-3">
          <label className="text-xs text-muted" htmlFor="staff-calendar-company-filter">
            所属先絞り込み
          </label>
          <span className="relative inline-flex items-center">
            <select
              id="staff-calendar-company-filter"
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="appearance-none rounded-lg border border-border py-1.5 pl-2 pr-6 text-xs"
            >
              <option value="">すべての所属先</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2 text-[9px] text-muted">▼</span>
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`py-1 text-center text-xs font-semibold ${weekdayColor(i)}`}>
            {w}
          </div>
        ))}
        {cells.map((c, i) => {
          if (!c.dateStr) {
            return <div key={i} className="h-[70px] sm:h-[100px]" />;
          }
          const dateStr = c.dateStr;
          const dow = new Date(dateStr + "T00:00:00Z").getUTCDay();
          const dayShifts = shiftsByDate.get(dateStr) ?? [];
          const dayRequests = requestsByDate.get(dateStr) ?? [];
          const isToday = dateStr === todayStr;
          const totalCount = dayShifts.length + dayRequests.length;
          const visibleShifts = dayShifts.slice(0, CONFIRMED_SLOT_BUDGET);
          const visibleRequests = dayRequests.slice(0, Math.max(0, CONFIRMED_SLOT_BUDGET - visibleShifts.length));
          const hasOverflow = totalCount > CONFIRMED_SLOT_BUDGET;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setSelectedDay(dateStr)}
              className={`relative flex h-[70px] flex-col items-stretch justify-start overflow-hidden rounded-lg p-1 text-left sm:h-[100px] sm:rounded-xl sm:rounded-tr-none sm:p-1.5 ${
                isToday ? "bg-accent/25" : "bg-white/40"
              }`}
            >
              <span className={`block text-center text-[11px] font-semibold ${weekdayColor(dow)}`}>{c.day}</span>
              {hasOverflow ? (
                <span
                  title={`他${totalCount - CONFIRMED_SLOT_BUDGET}件`}
                  className="absolute right-0 top-0 h-0 w-0 border-r-[14px] border-b-[14px] border-r-accent border-b-transparent"
                />
              ) : null}
              <div className="mt-px flex flex-col gap-[2px]">
                {visibleShifts.map((s) => (
                  <span
                    key={s.id}
                    className="block w-full truncate rounded bg-emerald-100 px-1.5 py-px text-center text-[8px] font-medium leading-tight text-emerald-900"
                  >
                    {isReportOverdue(s) ? (
                      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle" aria-label="未報告" />
                    ) : null}
                    {shortCompanyName(s.companyName)}
                  </span>
                ))}
                {visibleRequests.map((r) =>
                  r.desire === "OFF" ? (
                    <span
                      key={r.id}
                      className="block w-full rounded bg-gray-200 px-0.5 py-px text-center text-[8px] font-medium leading-tight text-gray-700"
                    >
                      休み
                    </span>
                  ) : (
                    <span
                      key={r.id}
                      className="block w-full rounded bg-orange-100 px-0.5 py-px text-center text-[8px] font-medium leading-tight text-orange-900"
                    >
                      希望申請中
                    </span>
                  ),
                )}
              </div>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setShowWizard(true)}
        aria-label="シフト希望を申請する"
        className="fixed bottom-8 right-8 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl text-primary-foreground shadow-lg"
      >
        <span
          className={`inline-block transition-transform duration-200 ${showWizard ? "rotate-45" : "rotate-0"}`}
        >
          ＋
        </span>
      </button>

      {selectedDay ? (
        <DayDetailPanel
          date={selectedDay}
          shifts={shiftsByDate.get(selectedDay) ?? []}
          requests={requestsByDate.get(selectedDay) ?? []}
          onNavigate={setSelectedDay}
          onRequest={() => {
            setWizardInitialDate(selectedDay);
            setSelectedDay(null);
            setShowWizard(true);
          }}
          onClose={() => setSelectedDay(null)}
        />
      ) : null}

      {showWizard ? (
        <RequestWizard
          year={year}
          month={month}
          companies={companies}
          initialDate={wizardInitialDate}
          onClose={() => {
            setShowWizard(false);
            setWizardInitialDate(null);
          }}
        />
      ) : null}
    </div>
  );
}

function formatDateJa(dateStr: string) {
  const [, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return `${m}月${d}日（${WEEKDAYS[dow]}）`;
}

// 日付をタップすると、予定の有無に関わらず詳細パネルが開く。予定が無い
// 日でも、そこからそのままシフト希望申請につなげられるようにしている。
function DayDetailPanel({
  date,
  shifts,
  requests,
  onNavigate,
  onRequest,
  onClose,
}: {
  date: string;
  shifts: ShiftRow[];
  requests: PendingRequestRow[];
  onNavigate: (dateStr: string) => void;
  onRequest: () => void;
  onClose: () => void;
}) {
  function shift(days: number) {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    onNavigate(d.toISOString().slice(0, 10));
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shift(-1)}
              aria-label="前の日"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-background hover:text-primary"
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <h3 className="font-serif-jp text-lg font-bold text-primary">{formatDateJa(date)}</h3>
            <button
              type="button"
              onClick={() => shift(1)}
              aria-label="次の日"
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-background hover:text-primary"
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>

        {shifts.length === 0 && requests.length === 0 ? (
          <p className="mb-5 rounded-xl bg-background/60 px-4 py-6 text-center text-sm text-muted">この日の予定はありません。</p>
        ) : (
          <ul className="mb-5 flex flex-col gap-2.5">
            {shifts.map((s) => (
              <li key={s.id} className="rounded-xl border border-border bg-white/60 p-3.5 text-sm shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {isReportOverdue(s) ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-label="未報告" />
                    ) : null}
                    <p className="font-semibold">{s.companyName}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">確定</span>
                </div>
                <p className="mt-1 text-muted">{s.isAllDay ? "終日" : s.isUndecided ? "未定" : `${s.startTime}〜${s.endTime}`}</p>
                {s.taskName ? <p className="mt-0.5 text-muted">業務内容：{s.taskName}</p> : null}
                {isReportOverdue(s) ? <p className="mt-1.5 text-xs font-medium text-red-600">業務報告が未提出です。</p> : null}
              </li>
            ))}
            {requests.map((r) =>
              r.desire === "OFF" ? (
                <li key={r.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3.5 text-sm shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-gray-700">{r.companyName}</p>
                    <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">休み希望</span>
                  </div>
                  <p className="mt-1 text-muted">会社の操作は不要です。</p>
                </li>
              ) : (
                <li key={r.id} className="rounded-xl border border-orange-200 bg-orange-50 p-3.5 text-sm shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-orange-900">{r.companyName}</p>
                    <span className="shrink-0 rounded-full bg-orange-200 px-2 py-0.5 text-xs font-medium text-orange-900">出勤希望</span>
                  </div>
                  <p className="mt-1 text-orange-800">会社の回答待ちです。</p>
                </li>
              ),
            )}
          </ul>
        )}

        <button
          type="button"
          onClick={onRequest}
          className="w-full rounded-lg border border-primary px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
        >
          この日にシフト希望を出す
        </button>
      </div>
    </div>
  );
}

function RequestWizard({
  year,
  month,
  companies,
  initialDate,
  onClose,
}: {
  year: number;
  month: number;
  companies: Company[];
  initialDate: string | null;
  onClose: () => void;
}) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [desire, setDesire] = useState<"WORK" | "OFF">("WORK");
  const [dates, setDates] = useState<string[]>(initialDate ? [initialDate] : []);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 勤務先が1つしかない場合は①のステップを飛ばして②から始める（多くの
  // スタッフは所属先が1つだけなので、わざわざ選ばせる意味が無い）。
  const skipCompanyStep = companies.length <= 1;
  const [step, setStep] = useState<1 | 2 | 3 | 4>(skipCompanyStep ? 2 : 1);

  const cells = useMemo(() => buildMonthCells(year, month), [year, month]);
  const selectedCompanyName = companies.find((c) => c.id === companyId)?.name ?? "";

  function toggleDate(dateStr: string) {
    setDates((prev) => (prev.includes(dateStr) ? prev.filter((d) => d !== dateStr) : [...prev, dateStr].sort()));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await submitShiftRequestAction({ companyId, desire, dates, note: note || undefined });
        onClose();
      } catch {
        setError("申請に失敗しました。");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">シフト希望申請</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>

        <div className="mb-3 flex items-center gap-1.5">
          {([1, 2, 3, 4] as const).map((s) => (
            <span key={s} className={`h-1.5 flex-1 rounded-full ${s <= step ? "bg-primary" : "bg-border"}`} />
          ))}
        </div>

        {step > 1 ? (
          <p className="mb-4 text-sm font-medium text-primary">
            {selectedCompanyName}
            {step > 2 ? `・${desire === "WORK" ? "出勤希望" : "休み希望"}` : ""}
          </p>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm font-semibold">申請先を選んでください</p>
            <div className="flex flex-col gap-2">
              {companies.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCompanyId(c.id)}
                  className={`rounded-lg border px-4 py-3 text-left text-sm ${
                    companyId === c.id ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={!companyId}
              onClick={() => setStep(2)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              次へ
            </button>
          </div>
        ) : step === 2 ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm font-semibold">出勤希望・休み希望を選んでください</p>
            <div className="flex gap-2 text-sm">
              <button
                type="button"
                onClick={() => setDesire("WORK")}
                className={`flex-1 rounded-lg border px-3 py-3 ${
                  desire === "WORK" ? "border-primary bg-primary/10 text-primary" : "border-border"
                }`}
              >
                出勤希望
              </button>
              <button
                type="button"
                onClick={() => setDesire("OFF")}
                className={`flex-1 rounded-lg border px-3 py-3 ${
                  desire === "OFF" ? "border-primary bg-primary/10 text-primary" : "border-border"
                }`}
              >
                休み希望
              </button>
            </div>
            <div className="flex gap-2">
              {!skipCompanyStep ? (
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-lg border border-border px-4 py-2 text-sm"
                >
                  戻る
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setStep(3)}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                次へ
              </button>
            </div>
          </div>
        ) : step === 3 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold">日付を選んでください（複数選択できます）</p>
            <p className="text-xs text-muted">{year}年{month}月</p>
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={`py-0.5 text-center text-[10px] font-semibold ${weekdayColor(i)}`}>
                  {w}
                </div>
              ))}
              {cells.map((c, i) => {
                if (!c.dateStr) return <div key={i} />;
                const dateStr = c.dateStr;
                const dow = new Date(dateStr + "T00:00:00Z").getUTCDay();
                const selected = dates.includes(dateStr);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDate(dateStr)}
                    className={`rounded-lg py-1.5 text-xs ${
                      selected
                        ? "bg-primary font-semibold text-primary-foreground"
                        : `hover:bg-background ${weekdayColor(dow)}`
                    }`}
                  >
                    {c.day}
                  </button>
                );
              })}
            </div>

            {dates.length > 0 ? <p className="text-xs text-muted">{dates.length}日を選択中</p> : null}

            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="備考（任意）"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              rows={3}
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-lg border border-border px-4 py-2 text-sm"
              >
                戻る
              </button>
              <button
                type="button"
                disabled={dates.length === 0}
                onClick={() => setStep(4)}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                次へ
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold">この内容で申請します</p>
            <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-background/40 p-3 text-sm">
              <p>勤務先：{selectedCompanyName}</p>
              <p>種別：{desire === "WORK" ? "出勤希望" : "休み希望"}</p>
              <p>日付：{dates.join("、")}</p>
              {note ? <p>備考：{note}</p> : null}
            </div>
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="rounded-lg border border-border px-4 py-2 text-sm"
              >
                戻る
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={submit}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                申請する
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
