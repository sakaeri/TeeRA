"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createAssignedShiftAction,
  matchShiftRequestAction,
  dismissShiftRequestAction,
  createPublicRecruitmentAction,
  updateMaxEntriesAction,
  stopRecruitmentAction,
  deleteRecruitmentAction,
} from "@/app/company/calendar/actions";

type ShiftRow = {
  id: string;
  date: string;
  staffName: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  isUndecided: boolean;
  source: string;
  clientName?: string;
  approvalStatus: string | null;
};

const APPROVAL_PILL: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-sky-100 text-sky-800",
  REJECTED: "bg-rose-100 text-rose-800",
};
const APPROVAL_LABEL: Record<string, string> = {
  PENDING: "未承認",
  APPROVED: "承認済み",
  REJECTED: "差戻し",
};

type StaffOption = { id: string; name: string };
type Team = { id: string; name: string };

type ShiftRequestRow = {
  id: string;
  staffName: string;
  desire: string;
  dates: string[];
  note: string | null;
};

type RecruitmentRow = {
  id: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  maxEntries: number;
  filled: number;
  lockedTee: number;
  status: string;
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function weekdayColor(dow: number) {
  if (dow === 0) return "text-red-600";
  if (dow === 6) return "text-blue-600";
  return "text-foreground";
}

export function CalendarView({
  year,
  month,
  selectedTeamId,
  shifts,
  staffOptions,
  teams,
  shiftRequests,
  recruitments,
  teeBalance,
  affordableMaxEntries,
  clients,
  initialSelectedDate,
}: {
  year: number;
  month: number;
  selectedTeamId?: string;
  shifts: ShiftRow[];
  staffOptions: StaffOption[];
  teams: Team[];
  shiftRequests: ShiftRequestRow[];
  recruitments: RecruitmentRow[];
  teeBalance: number;
  affordableMaxEntries: number;
  clients: { id: string; name: string }[];
  initialSelectedDate?: string;
}) {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState<string | null>(initialSelectedDate ?? null);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [showRecruitForm, setShowRecruitForm] = useState(false);
  const [sharingImage, setSharingImage] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const todayStr = new Date().toISOString().slice(0, 10);

  async function shareAsImage() {
    if (!gridRef.current || sharingImage) return;
    setSharingImage(true);
    try {
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(gridRef.current, { backgroundColor: "#ffffff", pixelRatio: 2 });
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `shift-calendar-${year}-${String(month).padStart(2, "0")}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setSharingImage(false);
    }
  }

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

  const selectedShifts = selectedDate ? shiftsByDate.get(selectedDate) ?? [] : [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="font-serif-jp text-2xl font-bold">シフトカレンダー</h1>
          <select
            value={selectedTeamId ?? ""}
            onChange={(e) => {
              const params = new URLSearchParams({ y: String(year), m: String(month) });
              if (e.target.value) params.set("team", e.target.value);
              router.push(`?${params.toString()}`);
            }}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm"
          >
            <option value="">全社（すべて表示）</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/api/calendar/pdf?y=${year}&m=${month}`}
            target="_blank"
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
          >
            📅 PDF出力
          </Link>
          <button
            type="button"
            disabled={sharingImage}
            onClick={shareAsImage}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs hover:border-primary hover:text-primary disabled:opacity-60"
          >
            {sharingImage ? "画像を作成中…" : "🖼 画像でシフトを共有"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4">
      <div className="mb-2 flex items-center justify-center gap-2">
        <Link
          href={`?y=${prev.y}&m=${prev.m}${selectedTeamId ? `&team=${selectedTeamId}` : ""}`}
          aria-label="前の月"
          className="rounded-full p-2 text-muted hover:bg-background hover:text-primary"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <div className="font-serif-jp text-lg font-bold">
          {year}年{month}月
        </div>
        <Link
          href={`?y=${next.y}&m=${next.m}${selectedTeamId ? `&team=${selectedTeamId}` : ""}`}
          aria-label="次の月"
          className="rounded-full p-2 text-muted hover:bg-background hover:text-primary"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>

      <div ref={gridRef} className="grid grid-cols-7 gap-1">
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
          const inhouseShifts = dayShifts.filter((s) => s.source === "INHOUSE");
          const clientShifts = dayShifts.filter((s) => s.source === "CLIENT");
          const dayRecruitments = recruitments.filter((r) => r.date === c.dateStr && r.status === "PUBLISHED");
          const recruitingCount = dayRecruitments.filter((r) => r.filled < r.maxEntries).length;
          const isToday = c.dateStr === todayStr;
          const isSelected = c.dateStr === selectedDate;

          // Cap the total number of tags shown (names + the two aggregate
          // tags) at 5 combined so the fixed-height cell never has to grow
          // or clip mid-tag — any excess just flips on the dog-ear marker.
          const tagEntries: { id: string; label: string; className: string }[] = [
            ...inhouseShifts.map((s) => ({
              id: s.id,
              label: s.staffName,
              className: "bg-emerald-100 text-emerald-900",
            })),
            ...(clientShifts.length > 0
              ? [{ id: "client", label: `オーダー${clientShifts.length}件`, className: "bg-sky-100 text-sky-900" }]
              : []),
            ...(recruitingCount > 0
              ? [{ id: "recruit", label: `募集中${recruitingCount}件`, className: "bg-amber-100 text-amber-900" }]
              : []),
          ];
          const visibleTags = tagEntries.slice(0, 5);
          const hasOverflow = tagEntries.length > 5;

          return (
            <button
              key={i}
              type="button"
              onClick={() => setSelectedDate(c.dateStr)}
              className={`relative flex h-[100px] flex-col items-stretch justify-start overflow-hidden rounded-xl p-1.5 text-left ${
                isToday ? "bg-accent/25" : isSelected ? "bg-accent/10" : "hover:bg-background"
              }`}
            >
              <span className={`block text-center text-[11px] font-semibold ${weekdayColor(dow)}`}>{c.day}</span>
              {hasOverflow ? (
                <span
                  title={`他${tagEntries.length - 5}件`}
                  className="absolute right-0 top-0 h-0 w-0 border-r-[14px] border-b-[14px] border-r-accent border-b-transparent"
                />
              ) : null}
              <div className="mt-px flex flex-col gap-[2px]">
                {visibleTags.map((tag) => (
                  <span
                    key={tag.id}
                    className={`truncate rounded-full px-1.5 py-px text-[8px] font-medium leading-tight ${tag.className}`}
                  >
                    {tag.label}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
      </div>

      {selectedDate ? (
        <DayDetailModal
          dateStr={selectedDate}
          shifts={selectedShifts}
          recruitments={recruitments.filter((r) => r.date === selectedDate)}
          onNavigate={setSelectedDate}
          onClose={() => setSelectedDate(null)}
        />
      ) : null}

      <FabMenu
        onCreateShift={() => setShowAssignForm(true)}
        onCreateRecruitment={() => setShowRecruitForm(true)}
      />

      {showAssignForm ? (
        <AssignShiftModal
          staffOptions={staffOptions}
          teams={teams}
          clients={clients}
          defaultDate={selectedDate ?? todayStr}
          onClose={() => setShowAssignForm(false)}
        />
      ) : null}

      {showRecruitForm ? (
        <RecruitmentFormModal
          teams={teams}
          defaultDate={selectedDate ?? todayStr}
          affordableMaxEntries={affordableMaxEntries}
          onClose={() => setShowRecruitForm(false)}
        />
      ) : null}

      <ShiftRequestsSection requests={shiftRequests} teams={teams} />
      <RecruitmentsSection recruitments={recruitments} affordableMaxEntries={affordableMaxEntries} />
    </div>
  );
}

function FabMenu({
  onCreateShift,
  onCreateRecruitment,
}: {
  onCreateShift: () => void;
  onCreateRecruitment: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-8 right-8 z-20 flex flex-col items-end gap-2">
      {open ? (
        <div className="mb-1 w-48 overflow-hidden rounded-xl border border-border bg-white shadow-lg">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onCreateShift();
            }}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-background"
          >
            🗓 シフトを作成
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onCreateRecruitment();
            }}
            className="flex w-full items-center gap-2 border-t border-border px-4 py-3 text-left text-sm hover:bg-background"
          >
            📣 オーダー募集
          </button>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl text-primary-foreground shadow-lg"
      >
        {open ? "✕" : "＋"}
      </button>
    </div>
  );
}

function DayDetailModal({
  dateStr,
  shifts,
  recruitments,
  onNavigate,
  onClose,
}: {
  dateStr: string;
  shifts: ShiftRow[];
  recruitments: RecruitmentRow[];
  onNavigate: (dateStr: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"shifts" | "recruit">("shifts");
  const remaining = recruitments.reduce((sum, r) => sum + Math.max(r.maxEntries - r.filled, 0), 0);

  const date = new Date(dateStr + "T00:00:00Z");
  const weekdayLabel = WEEKDAYS[date.getUTCDay()];
  const dateLabel = `${date.getUTCMonth() + 1}月${date.getUTCDate()}日（${weekdayLabel}）`;

  function shift(days: number) {
    const d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    onNavigate(d.toISOString().slice(0, 10));
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => shift(-1)} className="text-muted">
              ‹
            </button>
            <span className="font-serif-jp text-lg font-bold">{dateLabel}</span>
            <button type="button" onClick={() => shift(1)} className="text-muted">
              ›
            </button>
          </div>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>

        <div className="mb-4 flex gap-4 border-b border-border text-sm">
          <button
            type="button"
            onClick={() => setTab("shifts")}
            className={`border-b-2 px-1 py-2 font-semibold ${tab === "shifts" ? "border-accent text-primary" : "border-transparent text-muted"}`}
          >
            スタッフシフト
          </button>
          {recruitments.length > 0 ? (
            <button
              type="button"
              onClick={() => setTab("recruit")}
              className={`flex items-center gap-2 border-b-2 px-1 py-2 font-semibold ${tab === "recruit" ? "border-accent text-primary" : "border-transparent text-muted"}`}
            >
              募集一覧
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">残り{remaining}名</span>
            </button>
          ) : null}
        </div>

        {tab === "shifts" ? (
          shifts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">この日のシフトはありません。</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {shifts.map((s) => (
                <li key={s.id} className="flex items-center justify-between border-b border-border/50 py-2.5">
                  <span className="font-semibold">{s.staffName}</span>
                  <span className="text-muted">
                    {s.isAllDay ? "終日" : s.isUndecided ? "未定" : `${s.startTime}〜${s.endTime}`}
                  </span>
                  <span className="text-muted">{s.clientName ?? "自社"}</span>
                  {s.approvalStatus ? (
                    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${APPROVAL_PILL[s.approvalStatus] ?? "bg-gray-100 text-gray-700"}`}>
                      {APPROVAL_LABEL[s.approvalStatus] ?? s.approvalStatus}
                    </span>
                  ) : (
                    <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">未報告</span>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {recruitments.map((r) => (
              <li key={r.id} className="flex items-center justify-between border-b border-border/50 py-2.5">
                <span className="font-semibold">{r.title}</span>
                <span className="text-muted">
                  {r.startTime}〜{r.endTime}
                </span>
                <span className="rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-800">
                  残り{Math.max(r.maxEntries - r.filled, 0)}名
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">{title}</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AssignShiftModal({
  staffOptions,
  teams,
  clients,
  defaultDate,
  onClose,
}: {
  staffOptions: StaffOption[];
  teams: Team[];
  clients: { id: string; name: string }[];
  defaultDate: string;
  onClose: () => void;
}) {
  const [staffUserId, setStaffUserId] = useState(staffOptions[0]?.id ?? "");
  const [teamId, setTeamId] = useState("");
  const [companyRelationshipId, setCompanyRelationshipId] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [isAllDay, setIsAllDay] = useState(false);
  const [isUndecided, setIsUndecided] = useState(false);
  const [note, setNote] = useState("");
  const [conflicts, setConflicts] = useState<{ id: string; startTime: string | null; endTime: string | null }[] | null>(null);
  const [overrideChecked, setOverrideChecked] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(overrideShiftId?: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createAssignedShiftAction({
          teamId: teamId || undefined,
          staffUserId,
          date,
          startTime: isAllDay || isUndecided ? null : startTime,
          endTime: isAllDay || isUndecided ? null : endTime,
          isAllDay,
          isUndecided,
          note: note || undefined,
          overrideShiftId,
          companyRelationshipId: companyRelationshipId || undefined,
        });
        if (result.status === "conflict") {
          setConflicts(result.conflicts);
        } else {
          onClose();
        }
      } catch {
        setError("作成に失敗しました。");
      }
    });
  }

  return (
    <Modal title="シフトを作成" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="スタッフ">
          <select
            value={staffUserId}
            onChange={(e) => setStaffUserId(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          >
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        {teams.length > 0 ? (
          <Field label="チーム（任意）">
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            >
              <option value="">なし</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {clients.length > 0 ? (
          <Field label="取引先向け（依頼主）（任意）">
            <select
              value={companyRelationshipId}
              onChange={(e) => setCompanyRelationshipId(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            >
              <option value="">自社勤務</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="日付" className="col-span-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
        </Field>
        <div className="col-span-2 flex gap-4 text-xs">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={isAllDay} onChange={(e) => setIsAllDay(e.target.checked)} />
            終日
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={isUndecided} onChange={(e) => setIsUndecided(e.target.checked)} />
            未定
          </label>
        </div>
        {!isAllDay && !isUndecided ? (
          <>
            <Field label="開始">
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
            </Field>
            <Field label="終了">
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
            </Field>
          </>
        ) : null}
        <Field label="備考（任意）" className="col-span-2">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
        </Field>

        {conflicts ? (
          <div className="col-span-2 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700">
            <p className="mb-2 font-semibold">他のシフトと重複しています。</p>
            <ul className="mb-2 list-disc pl-4">
              {conflicts.map((c) => (
                <li key={c.id}>{c.startTime ? `${c.startTime}〜${c.endTime}` : "終日/未定"}</li>
              ))}
            </ul>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={overrideChecked}
                onChange={(e) => setOverrideChecked(e.target.checked)}
              />
              スタッフ本人と確認済み
            </label>
          </div>
        ) : null}

        {error ? <p className="col-span-2 text-xs text-red-600">{error}</p> : null}

        <button
          type="button"
          disabled={pending || !staffUserId || (conflicts !== null && !overrideChecked)}
          onClick={() => submit(conflicts && overrideChecked ? conflicts[0].id : undefined)}
          className="col-span-2 mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {conflicts ? "重複を確認のうえ作成する" : "作成する"}
        </button>
      </div>
    </Modal>
  );
}

function RecruitmentFormModal({
  teams,
  defaultDate,
  affordableMaxEntries,
  onClose,
}: {
  teams: Team[];
  defaultDate: string;
  affordableMaxEntries: number;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [teamId, setTeamId] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [hourlyWage, setHourlyWage] = useState("");
  const [maxEntries, setMaxEntries] = useState(Math.min(1, affordableMaxEntries));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cappedMax = Math.min(maxEntries, affordableMaxEntries);

  function submit(publish: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        await createPublicRecruitmentAction({
          teamId: teamId || undefined,
          title,
          date,
          startTime,
          endTime,
          hourlyWage: hourlyWage ? Number(hourlyWage) : undefined,
          maxEntries: cappedMax,
          publish,
        });
        onClose();
      } catch {
        setError("残高が不足しているため作成できません。");
      }
    });
  }

  return (
    <Modal title="公開募集を作成" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="タイトル">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
        </Field>
        {teams.length > 0 ? (
          <Field label="チーム（任意）">
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            >
              <option value="">なし</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="日付">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
        </Field>
        <div className="flex gap-2">
          <Field label="開始">
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </Field>
          <Field label="終了">
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </Field>
        </div>
        <Field label="時給（任意）">
          <input
            type="number"
            value={hourlyWage}
            onChange={(e) => setHourlyWage(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
        </Field>
        <Field label={`募集人数の上限（残高で賄える上限: ${affordableMaxEntries}名）`}>
          <input
            type="number"
            min={1}
            max={affordableMaxEntries}
            value={maxEntries}
            onChange={(e) => setMaxEntries(Number(e.target.value))}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
        </Field>
        <p className="text-xs text-muted">10 Tee × {cappedMax}名 = {cappedMax * 10} Tee がロックされます。</p>

        {error ? <p className="text-xs text-red-600">{error}</p> : null}

        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending || !title || affordableMaxEntries < 1}
            onClick={() => submit(true)}
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            公開する
          </button>
          <button
            type="button"
            disabled={pending || !title || affordableMaxEntries < 1}
            onClick={() => submit(false)}
            className="flex-1 rounded-lg border border-primary px-4 py-2 text-sm text-primary disabled:opacity-60"
          >
            下書き保存
          </button>
        </div>
        {affordableMaxEntries < 1 ? (
          <p className="text-xs text-red-600">
            Tee残高が不足しているため公開募集を開始できません。
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function ShiftRequestsSection({ requests, teams }: { requests: ShiftRequestRow[]; teams: Team[] }) {
  const [pending, startTransition] = useTransition();
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [matchDate, setMatchDate] = useState("");
  const [matchStart, setMatchStart] = useState("09:00");
  const [matchEnd, setMatchEnd] = useState("18:00");

  return (
    <div className="mt-8 rounded-xl border border-border bg-white/60 p-5">
      <h3 className="mb-3 font-semibold">未確定シフト</h3>
      {requests.length === 0 ? (
        <p className="text-sm text-muted">未確定のシフト希望はありません。</p>
      ) : (
        <ul className="flex flex-col gap-3 text-sm">
          {requests.map((r) => (
            <li key={r.id} className="rounded-lg border border-border/60 p-3">
              <div className="mb-1 flex items-center justify-between">
                <span>
                  {r.staffName} — {r.desire === "WORK" ? "出勤希望" : "休み希望"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setMatchingId(r.id);
                    setMatchDate(r.dates[0] ?? "");
                  }}
                  className="text-xs text-primary underline"
                >
                  マッチさせる
                </button>
              </div>
              <p className="text-xs text-muted">希望日: {r.dates.join("、")}</p>
              {r.note ? <p className="text-xs text-muted">メモ: {r.note}</p> : null}

              {matchingId === r.id ? (
                <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-border/50 pt-2">
                  <select
                    value={matchDate}
                    onChange={(e) => setMatchDate(e.target.value)}
                    className="rounded-lg border border-border px-2 py-1 text-xs"
                  >
                    {r.dates.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <input
                    type="time"
                    value={matchStart}
                    onChange={(e) => setMatchStart(e.target.value)}
                    className="rounded-lg border border-border px-2 py-1 text-xs"
                  />
                  <input
                    type="time"
                    value={matchEnd}
                    onChange={(e) => setMatchEnd(e.target.value)}
                    className="rounded-lg border border-border px-2 py-1 text-xs"
                  />
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        try {
                          await matchShiftRequestAction({
                            shiftRequestId: r.id,
                            date: matchDate,
                            startTime: matchStart,
                            endTime: matchEnd,
                            isAllDay: false,
                            isUndecided: false,
                          });
                          setMatchingId(null);
                        } catch (err) {
                          console.error("match failed", err);
                        }
                      })
                    }
                    className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
                  >
                    確定
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => startTransition(() => dismissShiftRequestAction(r.id))}
                    className="text-xs text-muted underline"
                  >
                    見送る
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecruitmentsSection({
  recruitments,
  affordableMaxEntries,
}: {
  recruitments: RecruitmentRow[];
  affordableMaxEntries: number;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-8 rounded-xl border border-border bg-white/60 p-5">
      <h3 className="mb-3 font-semibold">公開募集一覧</h3>
      {recruitments.length === 0 ? (
        <p className="text-sm text-muted">公開募集はありません。</p>
      ) : (
        <ul className="flex flex-col gap-3 text-sm">
          {recruitments.map((r) => (
            <li key={r.id} className="rounded-lg border border-border/60 p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">{r.title}</span>
                <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
                  {r.status === "PUBLISHED" ? "公開中" : r.status === "DRAFT" ? "下書き" : "停止中"}
                </span>
              </div>
              <p className="text-xs text-muted">
                {r.date} {r.startTime}〜{r.endTime} ／ 残り{Math.max(r.maxEntries - r.filled, 0)}名
                （上限{r.maxEntries}名・ロック中 {r.lockedTee} Tee）
              </p>
              {r.status === "PUBLISHED" ? (
                <div className="mt-2 flex gap-3 text-xs">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      const next = window.prompt("新しい人数上限", String(r.maxEntries));
                      if (!next) return;
                      startTransition(() => updateMaxEntriesAction(r.id, Number(next)));
                    }}
                    className="text-primary underline"
                  >
                    人数上限を変更
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => startTransition(() => stopRecruitmentAction(r.id))}
                    className="text-muted underline"
                  >
                    停止する
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => startTransition(() => deleteRecruitmentAction(r.id))}
                    className="text-red-600 underline"
                  >
                    削除する
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">残高で賄える人数上限: {affordableMaxEntries}名</p>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-1 flex-col gap-1 text-xs text-foreground/80 ${className ?? ""}`}>
      {label}
      {children}
    </label>
  );
}
