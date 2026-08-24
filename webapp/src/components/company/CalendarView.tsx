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
  assignStaffToRecruitmentAction,
  cancelShiftAction,
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
  companyRelationshipId?: string | null;
  note?: string | null;
  createdVia?: string;
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

type ClientRecruitmentRow = {
  id: string;
  clientCompanyName: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  maxEntries: number;
  filled: number;
};

type TagEntry =
  | { kind: "solid"; id: string; label: string; className: string }
  | { kind: "split"; id: string; left: { label: string; className: string }; right: { label: string; className: string } };

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
  clientRecruitments,
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
  clientRecruitments: ClientRecruitmentRow[];
  teeBalance: number;
  affordableMaxEntries: number;
  clients: { id: string; name: string }[];
  initialSelectedDate?: string;
}) {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState<string | null>(initialSelectedDate ?? null);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [assignPreset, setAssignPreset] = useState<{ date: string; companyRelationshipId?: string } | null>(null);
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

  const shiftRequestsByDate = useMemo(() => {
    const map = new Map<string, ShiftRequestRow[]>();
    for (const r of shiftRequests) {
      for (const d of r.dates) {
        if (!map.has(d)) map.set(d, []);
        map.get(d)!.push(r);
      }
    }
    return map;
  }, [shiftRequests]);

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
          const dayShiftRequests = shiftRequestsByDate.get(c.dateStr) ?? [];
          const isToday = c.dateStr === todayStr;
          const isSelected = c.dateStr === selectedDate;

          // 募集中/オーダー share one row (half each) when both exist on the
          // same day, so they count as a single slot toward the 5-slot cap.
          const recruitTag =
            recruitingCount > 0 ? { label: `募集中${recruitingCount}件`, className: "bg-amber-100 text-amber-900" } : null;
          const orderTag =
            clientShifts.length > 0 ? { label: `オーダー${clientShifts.length}件`, className: "bg-sky-100 text-sky-900" } : null;
          const recruitOrderTag: TagEntry | null =
            recruitTag && orderTag
              ? { kind: "split", id: "recruit-order", left: recruitTag, right: orderTag }
              : recruitTag
                ? { kind: "solid", id: "recruit", ...recruitTag }
                : orderTag
                  ? { kind: "solid", id: "client", ...orderTag }
                  : null;

          // Fixed row budget of 5 total: 未確定 (1 row, count only) and
          // 募集＆オーダー (1 row) each reserve their slot only when there's
          // something to show that day — confirmed-shift names get whatever's
          // left, so a day with no unconfirmed/recruit&order activity can
          // show up to 5 names instead of being capped at 3 regardless.
          const unconfirmedTag: TagEntry | null =
            dayShiftRequests.length > 0
              ? { kind: "solid", id: "unconfirmed", label: `未確定${dayShiftRequests.length}件`, className: "bg-rose-100 text-rose-900" }
              : null;

          const reservedRows = (unconfirmedTag ? 1 : 0) + (recruitOrderTag ? 1 : 0);
          const confirmedSlotBudget = 5 - reservedRows;
          const visibleConfirmed = inhouseShifts.slice(0, confirmedSlotBudget);
          const hasOverflow = inhouseShifts.length > confirmedSlotBudget;

          const tagEntries: TagEntry[] = [
            ...visibleConfirmed.map((s) => ({
              kind: "solid" as const,
              id: s.id,
              label: s.staffName,
              className: "bg-emerald-100 text-emerald-900",
            })),
            ...(unconfirmedTag ? [unconfirmedTag] : []),
            ...(recruitOrderTag ? [recruitOrderTag] : []),
          ];

          return (
            <button
              key={i}
              type="button"
              onClick={() => setSelectedDate(c.dateStr)}
              className={`relative flex h-[100px] flex-col items-stretch justify-start overflow-hidden rounded-xl rounded-tr-none p-1.5 text-left ${
                isToday ? "bg-accent/25" : isSelected ? "bg-accent/10" : "hover:bg-background"
              }`}
            >
              <span className={`block text-center text-[11px] font-semibold ${weekdayColor(dow)}`}>{c.day}</span>
              {hasOverflow ? (
                <span
                  title={`他${inhouseShifts.length - confirmedSlotBudget}件`}
                  className="absolute right-0 top-0 h-0 w-0 border-r-[14px] border-b-[14px] border-r-accent border-b-transparent"
                />
              ) : null}
              <div className="mt-px flex flex-col gap-[2px]">
                {tagEntries.map((tag) =>
                  tag.kind === "split" ? (
                    <div key={tag.id} className="flex gap-[2px]">
                      <span
                        className={`flex-1 truncate rounded-full px-1 py-px text-center text-[8px] font-medium leading-tight ${tag.left.className}`}
                      >
                        {tag.left.label}
                      </span>
                      <span
                        className={`flex-1 truncate rounded-full px-1 py-px text-center text-[8px] font-medium leading-tight ${tag.right.className}`}
                      >
                        {tag.right.label}
                      </span>
                    </div>
                  ) : (
                    <span
                      key={tag.id}
                      className={`truncate rounded-full px-1.5 py-px text-[8px] font-medium leading-tight ${tag.className}`}
                    >
                      {tag.label}
                    </span>
                  ),
                )}
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
          clientOrders={clientRecruitments.filter((r) => r.date === selectedDate)}
          staffOptions={staffOptions}
          onNavigate={setSelectedDate}
          onClose={() => setSelectedDate(null)}
          onAssign={(companyRelationshipId) => {
            setAssignPreset({ date: selectedDate, companyRelationshipId });
            setShowAssignForm(true);
          }}
        />
      ) : null}

      <FabMenu
        onCreateShift={() => {
          setAssignPreset(null);
          setShowAssignForm(true);
        }}
        onCreateRecruitment={() => setShowRecruitForm(true)}
      />

      {showAssignForm ? (
        <AssignShiftModal
          staffOptions={staffOptions}
          teams={teams}
          clients={clients}
          defaultDate={assignPreset?.date ?? selectedDate ?? todayStr}
          defaultCompanyRelationshipId={assignPreset?.companyRelationshipId}
          onClose={() => {
            setShowAssignForm(false);
            setAssignPreset(null);
          }}
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
  clientOrders,
  staffOptions,
  onNavigate,
  onClose,
  onAssign,
}: {
  dateStr: string;
  shifts: ShiftRow[];
  recruitments: RecruitmentRow[];
  clientOrders: ClientRecruitmentRow[];
  staffOptions: StaffOption[];
  onNavigate: (dateStr: string) => void;
  onClose: () => void;
  onAssign: (companyRelationshipId?: string) => void;
}) {
  const [tab, setTab] = useState<"shifts" | "client" | "recruit">("shifts");
  const [selectedClientKey, setSelectedClientKey] = useState<string | null>(null);
  const isPastDay = dateStr < new Date().toISOString().slice(0, 10);
  const remaining = recruitments.reduce((sum, r) => sum + Math.max(r.maxEntries - r.filled, 0), 0);
  const inhouseShifts = shifts.filter((s) => s.source !== "CLIENT");
  const clientShifts = shifts.filter((s) => s.source === "CLIENT");
  const hasUnreported = inhouseShifts.some((s) => !s.approvalStatus);

  const clientGroups = useMemo(() => {
    const map = new Map<string, { clientName: string; companyRelationshipId?: string; rows: ShiftRow[] }>();
    for (const s of clientShifts) {
      const key = s.companyRelationshipId ?? s.clientName ?? "依頼主未設定";
      const existing = map.get(key);
      if (existing) {
        existing.rows.push(s);
      } else {
        map.set(key, { clientName: s.clientName ?? "依頼主未設定", companyRelationshipId: s.companyRelationshipId ?? undefined, rows: [s] });
      }
    }
    return Array.from(map.entries()).map(([key, g]) => ({ key, ...g }));
  }, [clientShifts]);
  const selectedClientGroup = selectedClientKey ? clientGroups.find((g) => g.key === selectedClientKey) : undefined;

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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shift(-1)}
              aria-label="前の日"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-background hover:text-primary"
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
                <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="font-serif-jp text-lg font-bold">{dateLabel}</span>
            <button
              type="button"
              onClick={() => shift(1)}
              aria-label="次の日"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-background hover:text-primary"
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
                <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
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
            className={`relative border-b-2 px-1 py-2 font-semibold ${tab === "shifts" ? "border-accent text-primary" : "border-transparent text-muted"}`}
          >
            スタッフシフト
            {hasUnreported ? (
              <span className="absolute -right-1.5 -top-0.5 h-2 w-2 rounded-full bg-red-500" aria-label="未報告あり" />
            ) : null}
          </button>
          {clientShifts.length > 0 || clientOrders.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setTab("client");
                setSelectedClientKey(null);
              }}
              className={`border-b-2 px-1 py-2 font-semibold ${tab === "client" ? "border-accent text-primary" : "border-transparent text-muted"}`}
            >
              依頼主オーダー
            </button>
          ) : null}
          {recruitments.length > 0 ? (
            <button
              type="button"
              onClick={() => setTab("recruit")}
              className={`flex items-center gap-2 border-b-2 px-1 py-2 font-semibold ${tab === "recruit" ? "border-accent text-primary" : "border-transparent text-muted"}`}
            >
              募集一覧
              {!isPastDay && remaining > 0 ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">残り{remaining}名</span>
              ) : null}
            </button>
          ) : null}
        </div>

        {tab === "shifts" ? (
          inhouseShifts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">この日のシフトはありません。</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {inhouseShifts.map((s) => (
                <li
                  key={s.id}
                  className="grid grid-cols-[1fr_120px_70px_80px_auto] items-center gap-2 border-b border-border/50 py-2.5"
                >
                  <span className="truncate">
                    <span className="font-semibold">{s.staffName}</span>
                    {s.note ? <span className="ml-1.5 text-xs text-muted">（{s.note}）</span> : null}
                  </span>
                  <span className="text-muted">
                    {s.isAllDay ? "終日" : s.isUndecided ? "未定" : `${s.startTime}〜${s.endTime}`}
                  </span>
                  <span className="truncate text-muted">自社</span>
                  {s.approvalStatus ? (
                    <span className={`w-fit rounded-md px-2 py-1 text-xs font-semibold ${APPROVAL_PILL[s.approvalStatus] ?? "bg-gray-100 text-gray-700"}`}>
                      {APPROVAL_LABEL[s.approvalStatus] ?? s.approvalStatus}
                    </span>
                  ) : (
                    <span className="w-fit rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">未報告</span>
                  )}
                  {isPastDay ? null : <CancelShiftButton shiftId={s.id} staffName={s.staffName} />}
                </li>
              ))}
            </ul>
          )
        ) : tab === "client" ? (
          clientGroups.length === 0 && clientOrders.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">この日の依頼主オーダーはありません。</p>
          ) : selectedClientGroup ? (
            <div>
              <button
                type="button"
                onClick={() => setSelectedClientKey(null)}
                className="mb-2 flex items-center gap-1 text-sm text-muted hover:text-primary"
              >
                ‹ 依頼主一覧に戻る
              </button>
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold">{selectedClientGroup.clientName}</p>
                {isPastDay ? null : (
                  <button
                    type="button"
                    onClick={() => onAssign(selectedClientGroup.companyRelationshipId)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-background"
                  >
                    ＋ スタッフを追加
                  </button>
                )}
              </div>
              <ul className="flex flex-col gap-1 text-sm">
                {selectedClientGroup.rows.map((s) => (
                  <li
                    key={s.id}
                    className="grid grid-cols-[1fr_120px_80px_auto] items-center gap-2 border-b border-border/50 py-2.5"
                  >
                    <span className="truncate">
                      <span className="font-semibold">{s.staffName}</span>
                      {s.note ? <span className="ml-1.5 text-xs text-muted">（{s.note}）</span> : null}
                    </span>
                    <span className="text-muted">
                      {s.isAllDay ? "終日" : s.isUndecided ? "未定" : `${s.startTime}〜${s.endTime}`}
                    </span>
                    {s.approvalStatus ? (
                      <span className={`w-fit rounded-md px-2 py-1 text-xs font-semibold ${APPROVAL_PILL[s.approvalStatus] ?? "bg-gray-100 text-gray-700"}`}>
                        {APPROVAL_LABEL[s.approvalStatus] ?? s.approvalStatus}
                      </span>
                    ) : (
                      <span className="w-fit rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">未報告</span>
                    )}
                    {!isPastDay && s.createdVia === "PUBLIC_RECRUIT_ENTRY" ? <CancelShiftButton shiftId={s.id} staffName={s.staffName} /> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div>
              {clientOrders.length > 0 ? (
                <div className="mb-4">
                  <p className="mb-2 text-xs font-semibold text-muted">オーダー（依頼主からの募集）</p>
                  <ul className="flex flex-col gap-2 text-sm">
                    {clientOrders.map((o) => (
                      <ClientOrderRow key={o.id} order={o} staffOptions={staffOptions} disabled={isPastDay} />
                    ))}
                  </ul>
                </div>
              ) : null}
              {clientGroups.length > 0 ? (
                <div>
                  <p className="mb-2 text-xs font-semibold text-muted">アサイン済みスタッフ</p>
                  <ul className="flex flex-col gap-1 text-sm">
                    {clientGroups.map((g) => (
                      <li key={g.key}>
                        <button
                          type="button"
                          onClick={() => setSelectedClientKey(g.key)}
                          className="flex w-full items-center justify-between border-b border-border/50 py-2.5 text-left hover:bg-background"
                        >
                          <span className="font-semibold">{g.clientName}</span>
                          <span className="flex items-center gap-2 text-muted">
                            {g.rows.length}名
                            <span aria-hidden>›</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {recruitments.map((r) => (
              <li key={r.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{r.title}</p>
                    <p className="text-xs text-muted">
                      {r.startTime ?? "終日"}
                      {r.startTime ? `〜${r.endTime}` : ""}
                    </p>
                  </div>
                  <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                    {r.filled}/{r.maxEntries}名
                  </span>
                </div>
                {r.status === "PUBLISHED" && !isPastDay ? (
                  <RecruitmentAssignControls
                    recruitmentId={r.id}
                    remaining={Math.max(r.maxEntries - r.filled, 0)}
                    staffOptions={staffOptions}
                  />
                ) : r.status === "PUBLISHED" ? (
                  <p className="mt-2 text-xs text-muted">過去の日付のため変更できません。</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RecruitmentAssignControls({
  recruitmentId,
  remaining,
  staffOptions,
}: {
  recruitmentId: string;
  remaining: number;
  staffOptions: StaffOption[];
}) {
  const [staffUserId, setStaffUserId] = useState(staffOptions[0]?.id ?? "");
  const [confirming, setConfirming] = useState(false);
  const [conflicts, setConflicts] = useState<{ id: string; startTime: string | null; endTime: string | null }[] | null>(null);
  const [overrideChecked, setOverrideChecked] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function assign(overrideShiftIds?: string[]) {
    if (!staffUserId) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await assignStaffToRecruitmentAction({ recruitmentId, staffUserId, overrideShiftIds });
        if (result.status === "conflict") {
          setConflicts(result.conflicts);
        } else {
          setConflicts(null);
          setConfirming(false);
          setOverrideChecked(false);
        }
      } catch {
        setError("アサインに失敗しました。");
      }
    });
  }

  if (remaining <= 0) {
    return <p className="mt-2 text-xs text-muted">募集人数に達しています。</p>;
  }

  const staffName = staffOptions.find((s) => s.id === staffUserId)?.name ?? "";

  return (
    <div>
      <div className="mt-2 flex items-center gap-2">
        <select
          value={staffUserId}
          onChange={(e) => {
            setStaffUserId(e.target.value);
            setConfirming(false);
            setConflicts(null);
          }}
          className="flex-1 rounded-lg border border-border px-2 py-1.5 text-xs"
        >
          {staffOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {!confirming ? (
          <button
            type="button"
            disabled={!staffUserId}
            onClick={() => setConfirming(true)}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            アサイン
          </button>
        ) : null}
      </div>

      {confirming && !conflicts ? (
        <div className="mt-2 rounded-lg border border-border bg-background p-2 text-xs">
          <p className="mb-2">{staffName}さんをこの枠にアサインします。よろしいですか？</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => assign()}
              className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              確定
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-border px-3 py-1 text-xs"
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : null}

      {conflicts ? (
        <div className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2 text-xs text-red-700">
          <p className="mb-1 font-semibold">他のシフトと重複しています。</p>
          <ul className="mb-2 list-disc pl-4">
            {conflicts.map((c) => (
              <li key={c.id}>{c.startTime ? `${c.startTime}〜${c.endTime}` : "終日/未定"}</li>
            ))}
          </ul>
          <label className="mb-2 flex items-center gap-1">
            <input type="checkbox" checked={overrideChecked} onChange={(e) => setOverrideChecked(e.target.checked)} />
            スタッフ本人と確認済み
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || !overrideChecked}
              onClick={() => assign(conflicts.map((c) => c.id))}
              className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              重複を確認のうえアサインする
            </button>
            <button
              type="button"
              onClick={() => {
                setConflicts(null);
                setConfirming(false);
              }}
              className="rounded-lg border border-border px-3 py-1 text-xs"
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function CancelShiftButton({ shiftId, staffName }: { shiftId: string; staffName: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    setError(null);
    startTransition(async () => {
      try {
        await cancelShiftAction(shiftId);
        setOpen(false);
      } catch {
        setError("解除に失敗しました。");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="シフトを解除"
        title="シフトを解除"
        className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-red-50 hover:text-red-600"
      >
        ✕
      </button>
      {open ? (
        <Modal title="シフトを解除しますか？" onClose={() => setOpen(false)}>
          <p className="mb-4 text-sm text-muted">
            {staffName}さんのこのシフトを解除します。この操作は元に戻せません。
          </p>
          {error ? <p className="mb-2 text-xs text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm">
              キャンセル
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={confirm}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              解除する
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function ClientOrderRow({
  order,
  staffOptions,
  disabled,
}: {
  order: ClientRecruitmentRow;
  staffOptions: StaffOption[];
  disabled?: boolean;
}) {
  const remaining = Math.max(order.maxEntries - order.filled, 0);

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold">{order.clientCompanyName}</p>
          <p className="text-xs text-muted">
            {order.title} ・ {order.startTime ?? "終日"}
            {order.startTime ? `〜${order.endTime}` : ""}
          </p>
        </div>
        <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
          {order.filled}/{order.maxEntries}名
        </span>
      </div>
      {disabled ? (
        <p className="mt-2 text-xs text-muted">過去の日付のため変更できません。</p>
      ) : (
        <RecruitmentAssignControls recruitmentId={order.id} remaining={remaining} staffOptions={staffOptions} />
      )}
    </li>
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
  defaultCompanyRelationshipId,
  onClose,
}: {
  staffOptions: StaffOption[];
  teams: Team[];
  clients: { id: string; name: string }[];
  defaultDate: string;
  defaultCompanyRelationshipId?: string;
  onClose: () => void;
}) {
  const [staffUserId, setStaffUserId] = useState(staffOptions[0]?.id ?? "");
  const [teamId, setTeamId] = useState("");
  const [companyRelationshipId, setCompanyRelationshipId] = useState(defaultCompanyRelationshipId ?? "");
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

  function submit(overrideShiftIds?: string[]) {
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
          overrideShiftIds,
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
          onClick={() => submit(conflicts && overrideChecked ? conflicts.map((c) => c.id) : undefined)}
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
  const todayStr = new Date().toISOString().slice(0, 10);

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
              {r.status === "PUBLISHED" && r.date < todayStr ? (
                <p className="mt-2 text-xs text-muted">過去の日付のため変更できません。</p>
              ) : r.status === "PUBLISHED" ? (
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
