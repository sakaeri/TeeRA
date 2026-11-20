"use client";

import { allowedDesires } from "@/lib/requestDesire";
import { leadingBlankCount, orderedWeekdays, useMondayFirst } from "@/components/week/WeekStart";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { submitShiftRequestAction, cancelOwnShiftRequestDateAction } from "@/app/staff/actions";
import { todayJst, nowJstHHMM } from "@/lib/date";
import { holidayName } from "@/lib/holidays";
import { shortCompanyName } from "@/lib/shortCompanyName";
import { useMonthSwipe } from "@/lib/useMonthSwipe";

type ShiftRow = {
  id: string;
  date: string;
  companyId: string;
  companyName: string;
  workplaceName: string | null;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  isUndecided: boolean;
  // 提出済みの業務報告の状態（未提出ならnull）
  approvalStatus: string | null;
  outcome: string | null;
  reportedTimeLabel: string | null;
  workedMinutes: number;
  breakMinutes: number;
  rejectionReason: string | null;
  clockedOut: boolean;
  taskName: string | null;
  // ON_HOLD＝依頼主の都合で予定が変わり、会社が振り替え先を調整している最中
  status: string;
  // 募集から入ったシフトの、募集の備考と後から書き足されたお知らせ
  recruitmentNote: string | null;
  announcements: { id: string; body: string; createdAt: string }[];
};

type PendingRequestRow = {
  id: string;
  // 取り消し用（1件の申請が複数日を持つため、行のidとは別）
  requestId?: string;
  // 休み希望を会社が「休みで確定」したか
  acknowledged?: boolean;
  date: string;
  companyId: string;
  companyName: string;
  desire: "WORK" | "OFF";
  status: "PENDING" | "MATCHED" | "DISMISSED";
  note?: string | null;
};

type ReportShiftRow = { id: string; date: string; label: string; startTime: string | null; endTime: string | null };

type Company = { id: string; name: string; allowedRequestDesire?: string };

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// dateStrを渡すと祝日も日曜と同じ赤にする
function weekdayColor(dow: number, dateStr?: string) {
  if (dow === 0 || (dateStr && holidayName(dateStr))) return "text-red-600";
  if (dow === 6) return "text-blue-600";
  return "text-foreground";
}

// 業務報告の状態。「未提出」は業務時間を過ぎてから初めて意味を持つ警告 —
// 未来日やまだ終了時刻前の当日シフトを未提出扱いにすると、単なるノイズに
// なる（会社画面のCalendarView.tsxと同じ考え方）。当日でも退勤済みなら未提出。
type ReportState = "hold" | "unsubmitted" | "pending" | "approved" | "rejected" | "absent" | "cancelled" | null;

function reportState(s: ShiftRow): ReportState {
  if (s.status === "ON_HOLD") return "hold";
  if (s.outcome === "ABSENT") return "absent";
  if (s.outcome === "CANCELLED_BY_EMPLOYER") return "cancelled";
  if (s.approvalStatus === "APPROVED") return "approved";
  if (s.approvalStatus === "REJECTED") return "rejected";
  if (s.approvalStatus) return "pending";
  const todayStr = todayJst();
  if (s.date > todayStr) return null;
  if (s.date < todayStr || s.clockedOut) return "unsubmitted";
  if (s.isAllDay || s.isUndecided || !s.endTime) return null;
  return nowJstHHMM() >= s.endTime ? "unsubmitted" : null;
}

const REPORT_STATE: Record<Exclude<ReportState, null>, { label: string; tagClass: string; dotClass: string; badgeClass: string }> = {
  hold: { label: "調整中", tagClass: "bg-gray-200 text-gray-700", dotClass: "bg-gray-400", badgeClass: "bg-gray-100 text-gray-700" },
  unsubmitted: {
    label: "未提出",
    tagClass: "bg-orange-200 text-orange-900 font-semibold",
    dotClass: "bg-orange-500",
    badgeClass: "bg-orange-100 text-orange-800",
  },
  pending: { label: "承認待ち", tagClass: "bg-yellow-100 text-yellow-900", dotClass: "bg-yellow-400", badgeClass: "bg-yellow-100 text-yellow-900" },
  approved: { label: "承認済み", tagClass: "bg-emerald-100 text-emerald-900", dotClass: "bg-emerald-500", badgeClass: "bg-sky-100 text-sky-800" },
  rejected: { label: "差戻し", tagClass: "bg-red-100 text-red-800 font-semibold", dotClass: "bg-red-500", badgeClass: "bg-rose-100 text-rose-800" },
  absent: { label: "欠勤", tagClass: "bg-gray-100 text-gray-500 line-through", dotClass: "bg-gray-400", badgeClass: "bg-gray-100 text-gray-700" },
  cancelled: {
    label: "勤務先キャンセル",
    tagClass: "bg-gray-100 text-gray-500 line-through",
    dotClass: "bg-gray-400",
    badgeClass: "bg-gray-100 text-gray-700",
  },
};

function buildMonthCells(year: number, month: number, mondayFirst: boolean) {
  const startDow = leadingBlankCount(year, month, mondayFirst);
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
  year: dataYear,
  month: dataMonth,
  companies,
  shifts,
  pendingRequests,
  reportShifts = [],
  bulkReportCount = 0,
}: {
  year: number;
  month: number;
  companies: Company[];
  shifts: ShiftRow[];
  pendingRequests: PendingRequestRow[];
  reportShifts?: ReportShiftRow[];
  bulkReportCount?: number;
}) {
  const [showWizard, setShowWizard] = useState(false);
  // 「＋」で開く、何をするか選ぶメニュー（業務報告／シフト希望）
  const [showMenu, setShowMenu] = useState(false);
  const [wizardInitialDate, setWizardInitialDate] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [companyFilter, setCompanyFilter] = useState("");
  const todayStr = todayJst();
  // 月送り（押した瞬間に次の月の枠を出す・指に合わせて動く・横スワイプ中は縦に動かない）
  const {
    year,
    month,
    goToMonth,
    containerRef: swipeContainerRef,
    style: swipeStyle,
  } = useMonthSwipe({ year: dataYear, month: dataMonth, hrefFor: (y, m) => `?y=${y}&m=${m}` });

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

  const mondayFirst = useMondayFirst();
  const cells = useMemo(() => buildMonthCells(year, month, mondayFirst), [year, month, mondayFirst]);

  const CONFIRMED_SLOT_BUDGET = 5;
  // 月によって5行/6行と変わっても月カード全体の縦幅は一定に保ち（＋ボタンの
  // 裏まで届くように)、その差は週の行の高さ側で吸収する。
  const weeks = Math.max(1, Math.ceil(cells.length / 7));

  return (
    <div className="flex flex-1 flex-col overflow-x-clip rounded-2xl bg-white p-1.5 sm:block sm:p-4">
      <div className="mb-2 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => goToMonth(-1)}
          aria-label="前の月"
          className="rounded-full p-2 text-muted hover:bg-background hover:text-primary"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <Link
          href={`?y=${todayStr.slice(0, 4)}&m=${Number(todayStr.slice(5, 7))}`}
          className="rounded-lg px-2 py-1 font-serif-jp text-lg font-bold hover:bg-background"
        >
          {year}年{month}月
        </Link>
        <button
          type="button"
          onClick={() => goToMonth(1)}
          aria-label="次の月"
          className="rounded-full p-2 text-muted hover:bg-background hover:text-primary"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
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

      <div ref={swipeContainerRef} className="flex flex-1 flex-col sm:contents" style={swipeStyle}>
      <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
        {orderedWeekdays(mondayFirst).map(({ dow, label }) => (
          <div key={label} className={`py-1 text-center text-xs font-semibold ${weekdayColor(dow)}`}>
            {label}
          </div>
        ))}
      </div>
      <div
        className="grid flex-1 grid-cols-7 gap-0.5 sm:grid-rows-none sm:gap-1"
        style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
      >
        {cells.map((c, i) => {
          if (!c.dateStr) {
            return <div key={i} className="h-full sm:h-[100px]" />;
          }
          const dateStr = c.dateStr;
          const dow = new Date(dateStr + "T00:00:00Z").getUTCDay();
          const dayShifts = shiftsByDate.get(dateStr) ?? [];
          // 見送り済みはもう対応する必要のない過去の記録でしかなく、複数
          // 件溜まるとカレンダーの枠を圧迫して見た目も良くないため、日
          // セルのバッジには出さない（日付詳細を開けば確認できる）。
          // 休みで確定した日でも、会社がシフトを入れた場合はシフトの方を出す
          const dayRequests = (requestsByDate.get(dateStr) ?? []).filter(
            (r) => r.status !== "DISMISSED" && !(r.desire === "OFF" && dayShifts.length > 0),
          );
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
              className={`relative flex h-full flex-col items-stretch justify-start overflow-hidden rounded-lg rounded-tr-none px-0 py-1 text-left sm:h-[100px] sm:rounded-xl sm:rounded-tr-none sm:p-1.5 ${
                isToday ? "bg-accent/25" : "bg-white/40"
              }`}
            >
              <span
                title={holidayName(dateStr) ?? undefined}
                className={`block text-center text-[11px] font-semibold ${weekdayColor(dow, dateStr)}`}
              >
                {c.day}
              </span>
              {hasOverflow ? (
                <span
                  title={`他${totalCount - CONFIRMED_SLOT_BUDGET}件`}
                  className="absolute right-0 top-0 h-0 w-0 border-r-[8px] border-b-[8px] border-r-accent border-b-transparent"
                />
              ) : null}
              <div className="mt-px flex flex-col gap-[2px]">
                {visibleShifts.map((s) => {
                  const state = reportState(s);
                  return (
                    <span
                      key={s.id}
                      title={state ? REPORT_STATE[state].label : undefined}
                      data-report-state={state ?? "none"}
                      className={`block w-full overflow-hidden text-clip whitespace-nowrap rounded px-0 py-px text-center text-[8px] font-medium leading-tight tracking-tighter ${
                        state ? REPORT_STATE[state].tagClass : "bg-emerald-100 text-emerald-900"
                      }`}
                    >
                      {state === "hold" ? "調整中" : shortCompanyName(s.workplaceName ?? s.companyName)}
                    </span>
                  );
                })}
                {/* 申請中（出勤・休みとも）＝薄い青、休みで確定＝グレー（シフト確定は上の緑） */}
                {visibleRequests.map((r) =>
                  r.desire === "OFF" && r.acknowledged ? (
                    <span
                      key={r.id}
                      data-request-tag="off-confirmed"
                      className="block w-full rounded bg-gray-200 px-0.5 py-px text-center text-[8px] font-medium leading-tight text-gray-700"
                    >
                      休み
                    </span>
                  ) : (
                    <span
                      key={r.id}
                      data-request-tag={r.desire === "OFF" ? "off-pending" : "work-pending"}
                      className="block w-full overflow-hidden text-clip whitespace-nowrap rounded bg-sky-100 px-0 py-px text-center text-[8px] font-medium leading-tight tracking-tighter text-sky-900"
                    >
                      {r.desire === "OFF" ? "休み申請中" : "出勤申請中"}
                    </span>
                  ),
                )}
              </div>
            </button>
          );
        })}
      </div>
      </div>

      <button
        type="button"
        onClick={() => {
          if (showWizard) setShowWizard(false);
          else setShowMenu((v) => !v);
        }}
        aria-label="業務報告・シフト希望"
        data-testid="staff-plus"
        className={`fixed bottom-8 right-8 ${showMenu ? "z-40" : "z-10"} flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl text-primary-foreground shadow-lg`}
      >
        <span
          className={`inline-block transition-transform duration-200 ${showWizard || showMenu ? "rotate-45" : "rotate-0"}`}
        >
          ＋
        </span>
        {/* 業務報告がまだのシフトの数（報告を忘れにくくする） */}
        {reportShifts.length > 0 && !showMenu && !showWizard ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[11px] font-bold text-white">
            {reportShifts.length}
          </span>
        ) : null}
      </button>

      {showMenu ? (
        <PlusMenu
          reportShifts={reportShifts}
          bulkReportCount={bulkReportCount}
          onRequest={() => {
            setShowMenu(false);
            setShowWizard(true);
          }}
          onClose={() => setShowMenu(false)}
        />
      ) : null}

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
          pendingRequests={pendingRequests}
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
  const holiday = holidayName(dateStr);
  return `${m}月${d}日（${WEEKDAYS[dow]}${holiday ? `・${holiday}` : ""}）`;
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
      <div className="max-h-popup w-full overflow-y-auto max-w-sm rounded-2xl bg-white p-6 shadow-lg">
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
          <ul className="mb-5 flex flex-col gap-2">
            {shifts.map((s) => {
              const state = reportState(s);
              const scheduled = s.isAllDay ? "終日" : s.isUndecided ? "未定" : `${s.startTime}〜${s.endTime}`;
              // 報告済みなら予定ではなく報告した時間（実働・休憩つき）を出す
              const secondary = s.reportedTimeLabel
                ? `${s.reportedTimeLabel}（実働${Math.round((s.workedMinutes / 60) * 10) / 10}時間／休憩${s.breakMinutes}分）`
                : scheduled;
              return (
                <DetailAccordionItem
                  key={s.id}
                  dotClassName={state ? REPORT_STATE[state].dotClass : "bg-emerald-500"}
                  primary={state === "hold" ? "調整中" : (s.workplaceName ?? s.companyName)}
                  secondary={state === "hold" ? scheduled : secondary}
                  badge={
                    state && state !== "hold" ? (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${REPORT_STATE[state].badgeClass}`}>
                        {REPORT_STATE[state].label}
                      </span>
                    ) : null
                  }
                  defaultOpen={state === "unsubmitted" || state === "rejected" || s.announcements.length > 0}
                >
                  {state === "hold" ? (
                    <p className="font-medium text-foreground">
                      予定が変更になり、会社が調整しています。会社から連絡がありますので、休みと判断せずにお待ちください。
                    </p>
                  ) : null}
                  <p>所属会社：{s.companyName}</p>
                  {s.taskName ? <p>業務内容：{s.taskName}</p> : null}
                  {s.reportedTimeLabel ? <p>予定：{scheduled}</p> : null}
                  {s.recruitmentNote ? <p className="whitespace-pre-wrap">備考：{s.recruitmentNote}</p> : null}
                  {s.announcements.map((a) => (
                    <div key={a.id} className="mt-1 rounded-lg bg-accent/15 px-3 py-2 text-foreground">
                      <p className="text-[10px] font-semibold text-primary">お知らせ</p>
                      <p className="whitespace-pre-wrap">{a.body}</p>
                    </div>
                  ))}
                  {state === "rejected" && s.rejectionReason ? (
                    <p className="font-medium text-red-700">差戻しの理由：{s.rejectionReason}</p>
                  ) : null}
                  {state === "unsubmitted" || state === "rejected" ? (
                    <Link
                      href={`/staff/timecard#shift-${s.id}`}
                      className="mt-1 inline-block rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                    >
                      {state === "rejected" ? "業務報告を直して出し直す" : "業務報告を提出する"}
                    </Link>
                  ) : null}
                </DetailAccordionItem>
              );
            })}
            {requests.map((r) =>
              r.status === "DISMISSED" ? (
                <DetailAccordionItem
                  key={r.id}
                  dotClassName="bg-gray-400"
                  primary={r.desire === "OFF" ? "休みは見送られました" : "今回は見送られました"}
                >
                  <p>所属会社：{r.companyName}</p>
                </DetailAccordionItem>
              ) : (
                <DetailAccordionItem
                  key={r.id}
                  dotClassName={r.desire === "OFF" && r.acknowledged ? "bg-gray-400" : "bg-sky-500"}
                  primary={
                    r.desire === "OFF"
                      ? r.acknowledged
                        ? "休み（会社が確定しました）"
                        : "休み申請中（会社の確認待ち）"
                      : "出勤申請中（会社の回答待ち）"
                  }
                >
                  <p>所属会社：{r.companyName}</p>
                  {r.note ? <p className="whitespace-pre-wrap break-words">備考：{r.note}</p> : null}
                  {r.requestId && date >= todayJst() ? <CancelRequestButton requestId={r.requestId} date={date} desire={r.desire} confirmedOff={r.desire === "OFF" && Boolean(r.acknowledged)} /> : null}
                </DetailAccordionItem>
              ),
            )}
          </ul>
        )}

        {date >= todayJst() ? (
          <button
            type="button"
            onClick={onRequest}
            className="w-full rounded-lg border border-primary px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
          >
            ＋シフト希望を作成
          </button>
        ) : null}
      </div>
    </div>
  );
}

// 「一目で状況が分かる見出し」＋「タップして開く詳細」の2段構成。会社名
// や備考などの二次情報を毎回全部並べると縦に長く煩雑になるため、まず
// 状況（勤務先・時間／休み希望・出勤希望の別）だけを見せ、詳細は▼で
// 開いた時だけ出す。
function DetailAccordionItem({
  dotClassName,
  primary,
  secondary,
  badge,
  defaultOpen = false,
  children,
}: {
  dotClassName: string;
  primary: string;
  secondary?: string;
  // 見出しの右に出す小さなラベル（業務報告の状態など）
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <li className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotClassName}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{primary}</span>
          {secondary ? <span className="block text-xs text-muted">{secondary}</span> : null}
        </span>
        {badge ? <span className="shrink-0">{badge}</span> : null}
        <svg
          viewBox="0 0 20 20"
          fill="none"
          className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="flex flex-col gap-1 border-t border-black/5 px-4 py-3 text-xs text-muted">{children}</div>
      ) : null}
    </li>
  );
}

function RequestWizard({
  year,
  month,
  companies,
  initialDate,
  pendingRequests,
  onClose,
}: {
  year: number;
  month: number;
  companies: Company[];
  initialDate: string | null;
  // もう出している希望（申請済みの日に薄く色を付け、選んだら注意を出す。同じ日を何度も
  // 申請してしまうのを防ぐため。早番・遅番を別々に出すこともあるので、申請自体は止めない）
  pendingRequests: PendingRequestRow[];
  onClose: () => void;
}) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  // 会社がこのスタッフに出せるようにしている希望（1種類だけなら、選ぶ画面を飛ばす）
  const desiresFor = (id: string) => allowedDesires(companies.find((c) => c.id === id)?.allowedRequestDesire);
  const [desire, setDesire] = useState<"WORK" | "OFF">(() => desiresFor(companies[0]?.id ?? "")[0]);
  const singleDesire = desiresFor(companyId).length === 1;
  const [dates, setDates] = useState<string[]>(initialDate ? [initialDate] : []);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 勤務先が1つしかない場合は①のステップを飛ばして②から始める（多くの
  // スタッフは所属先が1つだけなので、わざわざ選ばせる意味が無い）。
  const skipCompanyStep = companies.length <= 1;
  const [step, setStep] = useState<1 | 2 | 3 | 4>(
    skipCompanyStep ? (desiresFor(companies[0]?.id ?? "").length === 1 ? 3 : 2) : 1,
  );

  // 申請する月は前後に切り替えられる（開いた時はカレンダーで見ていた月、
  // 日付から開いた時はその日の月）。今月より前には戻れない。選んだ日付は
  // 月を切り替えても残る。
  const [view, setView] = useState(() =>
    initialDate ? { y: Number(initialDate.slice(0, 4)), m: Number(initialDate.slice(5, 7)) } : { y: year, m: month },
  );
  const mondayFirst = useMondayFirst();
  const cells = useMemo(() => buildMonthCells(view.y, view.m, mondayFirst), [view, mondayFirst]);
  const todayYm = todayJst().slice(0, 7);
  const viewYm = `${view.y}-${String(view.m).padStart(2, "0")}`;
  function shiftViewMonth(delta: number) {
    setView((v) => {
      const d = new Date(Date.UTC(v.y, v.m - 1 + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
    });
  }
  const selectedCompanyName = companies.find((c) => c.id === companyId)?.name ?? "";
  // 選んでいる会社に申請済みの日（見送られた分は除く）
  const requestedByDate = new Map<string, PendingRequestRow[]>();
  for (const r of pendingRequests) {
    if (r.companyId !== companyId || r.status === "DISMISSED") continue;
    requestedByDate.set(r.date, [...(requestedByDate.get(r.date) ?? []), r]);
  }
  const alreadyRequestedSelected = dates.filter((d) => requestedByDate.has(d));

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
      <div className="max-h-popup w-full overflow-y-auto max-w-md rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">シフト希望申請</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        <p className="-mt-2 mb-3 text-[11px] text-muted">これからの出勤・休みの希望を出す画面です。働いた報告は「＋」の「業務報告」からです。</p>

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
              onClick={() => {
                const ds = desiresFor(companyId);
                if (!ds.includes(desire)) setDesire(ds[0]);
                setStep(ds.length === 1 ? 3 : 2);
              }}
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
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => shiftViewMonth(-1)}
                disabled={viewYm <= todayYm}
                aria-label="前の月"
                className="rounded-full p-1.5 text-muted hover:bg-background hover:text-primary disabled:opacity-30"
              >
                <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                  <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <p className="text-sm font-semibold text-foreground">
                {view.y}年{view.m}月
              </p>
              <button
                type="button"
                onClick={() => shiftViewMonth(1)}
                aria-label="次の月"
                className="rounded-full p-1.5 text-muted hover:bg-background hover:text-primary"
              >
                <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                  <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {orderedWeekdays(mondayFirst).map(({ dow, label }) => (
                <div key={label} className={`py-0.5 text-center text-[10px] font-semibold ${weekdayColor(dow)}`}>
                  {label}
                </div>
              ))}
              {cells.map((c, i) => {
                if (!c.dateStr) return <div key={i} />;
                const dateStr = c.dateStr;
                const dow = new Date(dateStr + "T00:00:00Z").getUTCDay();
                const selected = dates.includes(dateStr);
                const requested = requestedByDate.has(dateStr);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDate(dateStr)}
                    data-requested={requested ? "true" : undefined}
                    className={`rounded-lg py-1.5 text-xs ${
                      selected
                        ? "bg-primary font-semibold text-primary-foreground"
                        : requested
                          ? `bg-sky-50 ring-1 ring-sky-200 hover:bg-sky-100 ${weekdayColor(dow, dateStr)}`
                          : `hover:bg-background ${weekdayColor(dow, dateStr)}`
                    }`}
                  >
                    {c.day}
                  </button>
                );
              })}
            </div>

            {requestedByDate.size > 0 ? (
              <p className="flex items-center gap-1.5 text-[11px] text-muted">
                <span className="inline-block h-3 w-3 rounded bg-sky-50 ring-1 ring-sky-200" />
                {selectedCompanyName}に申請済みの日
              </p>
            ) : null}
            {dates.length > 0 ? <p className="text-xs text-muted">{dates.length}日を選択中</p> : null}
            {alreadyRequestedSelected.length > 0 ? (
              <div className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900" data-testid="already-requested">
                <p className="font-semibold">
                  {alreadyRequestedSelected.length === 1 ? "この日" : "これらの日"}は申請済みですが、追加で申請しますか？
                </p>
                {alreadyRequestedSelected.map((d) => (
                  <p key={d}>
                    {Number(d.slice(5, 7))}/{Number(d.slice(8, 10))}（申請済み：
                    {requestedByDate
                      .get(d)!
                      .map((r) => `${r.desire === "WORK" ? "出勤希望" : "休み希望"}${r.note ? `・備考：${r.note}` : ""}`)
                      .join("／")}
                    ）
                  </p>
                ))}
              </div>
            ) : null}

            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="備考（任意）"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              rows={3}
            />

            <div className="flex gap-2">
              {!(singleDesire && skipCompanyStep) ? (
                <button
                  type="button"
                  onClick={() => setStep(singleDesire ? 1 : 2)}
                  className="rounded-lg border border-border px-4 py-2 text-sm"
                >
                  戻る
                </button>
              ) : null}
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

// 自分の申請をこの日だけ取り消す。確定した休みの取り消しは会社に通知される
function CancelRequestButton({
  requestId,
  date,
  desire,
  confirmedOff,
}: {
  requestId: string;
  date: string;
  desire: "WORK" | "OFF";
  confirmedOff: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-background"
        data-testid="cancel-request"
      >
        この日の{desire === "OFF" ? "休み" : "出勤"}申請を取り消す
      </button>
    );
  }
  return (
    <div className="mt-1 flex flex-col gap-1.5 rounded-lg bg-background px-3 py-2">
      <p className="text-xs">
        {confirmedOff ? "会社が確定した休みです。取り消すと会社に知らせます。取り消しますか？" : "この日の申請を取り消しますか？"}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                await cancelOwnShiftRequestDateAction(requestId, date);
              } catch {
                setError("取り消せませんでした。");
              }
            })
          }
          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          data-testid="cancel-request-confirm"
        >
          取り消す
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs">
          やめる
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

// 「＋」で開くメニュー。業務報告（報告がまだのシフト・シフト外の勤務）と、シフト希望の申請を選ぶ
function PlusMenu({
  reportShifts,
  bulkReportCount,
  onRequest,
  onClose,
}: {
  reportShifts: ReportShiftRow[];
  bulkReportCount: number;
  onRequest: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/30 p-4 pb-28" onClick={onClose}>
      <div className="max-h-popup w-full overflow-y-auto max-w-md rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()} data-testid="plus-menu">
        <p className="mb-2 text-sm font-semibold text-primary">業務報告をする</p>
        {/* 前日以前の未提出が2件以上なら、まとめて報告へ */}
        {bulkReportCount >= 2 ? (
          <Link
            href="/staff/timecard?bulk=1"
            className="mb-2 block rounded-lg bg-primary px-3 py-2 text-center text-sm font-semibold text-primary-foreground"
            data-testid="plus-bulk-report"
          >
            まとめて報告（{bulkReportCount}件）
          </Link>
        ) : null}
        {reportShifts.length > 0 ? (
          <ul className="mb-2 flex flex-col gap-1.5">
            {reportShifts.map((s) => {
              const dt = new Date(`${s.date}T00:00:00Z`);
              return (
                <li key={s.id}>
                  <Link
                    href={`/staff/timecard#shift-${s.id}`}
                    className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm hover:bg-orange-100"
                    data-testid="plus-report-shift"
                  >
                    <span>
                      {dt.getUTCMonth() + 1}月{dt.getUTCDate()}日（{WEEKDAYS[dt.getUTCDay()]}）{s.label}
                      {s.startTime ? <span className="ml-1 text-xs text-muted">{s.startTime}〜{s.endTime}</span> : null}
                    </span>
                    <span className="shrink-0 whitespace-nowrap pl-2 text-xs font-semibold text-orange-800">報告する ›</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mb-2 rounded-lg bg-background px-3 py-2 text-xs text-muted">提出待ちの業務報告はありません。</p>
        )}
        <Link
          href="/staff/timecard?unscheduled=1"
          className="mb-4 block rounded-lg border border-dashed border-primary/50 px-3 py-2 text-center text-xs font-semibold text-primary"
        >
          シフト外で働いた日を報告する
        </Link>
        <p className="mb-2 text-sm font-semibold text-primary">シフト希望を出す</p>
        <button
          type="button"
          onClick={onRequest}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
          data-testid="plus-request"
        >
          出勤・休みの希望を出す
        </button>
      </div>
    </div>
  );
}
