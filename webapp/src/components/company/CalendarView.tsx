"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { todayJst, nowJstHHMM } from "@/lib/date";
import { useClickOutside } from "@/lib/useClickOutside";
import {
  createAssignedShiftAction,
  matchShiftRequestAction,
  dismissShiftRequestAction,
  createPublicRecruitmentAction,
  updateMaxEntriesAction,
  deleteRecruitmentAction,
  openRecruitmentToPublicAction,
  saveRecruitmentPublicDraftAction,
  assignStaffToRecruitmentAction,
  cancelShiftAction,
} from "@/app/company/calendar/actions";

type ShiftRow = {
  id: string;
  date: string;
  staffUserId: string;
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
  publicRecruitmentId?: string | null;
  originLabel?: string; // source=INHOUSEのみ意味を持つ: 自社／配属：◯◯／公開募集
  approvalStatus: string | null;
};

type ShiftHistoryRow = {
  id: string;
  date: string;
  staffName: string;
  publicRecruitmentId: string | null;
  status: string; // "SUPERSEDED" | "CANCELLED"
  originLabel: string | null; // 元々どの会社／募集の枠だったか（会社名／募集タイトル）
};

const SHIFT_HISTORY_LABEL: Record<string, string> = {
  SUPERSEDED: "別の枠に変更",
  CANCELLED: "キャンセル済み",
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
  note: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  isUndecided: boolean;
  maxEntries: number;
  filled: number;
  lockedTee: number;
  status: string;
  visibility: string; // "ORDER" | "PUBLIC"
  hourlyWage: number | null;
  wageType: string | null;
  extraItems: { label: string; value: string }[];
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

type TagEntry = { kind: "solid"; id: string; label: string; className: string };

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// 「未報告」の赤丸は、業務時間を過ぎてから初めて意味を持つ警告 — 未来日や
// まだ終了時刻前の当日シフトを「未報告」扱いにすると、単なるノイズになる。
function isReportOverdue(s: ShiftRow) {
  if (s.approvalStatus) return false;
  const todayStr = todayJst();
  if (s.date > todayStr) return false;
  if (s.date < todayStr) return true;
  if (s.isAllDay || s.isUndecided || !s.endTime) return false;
  return nowJstHHMM() >= s.endTime;
}

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
  shiftHistory,
  staffOptions,
  teams,
  shiftRequests,
  recruitments,
  clientRecruitments,
  teeBalance,
  affordableMaxEntries,
  clients,
  agencies,
  selectedRelationshipId,
  companyName,
  initialSelectedDate,
}: {
  year: number;
  month: number;
  selectedTeamId?: string;
  shifts: ShiftRow[];
  shiftHistory: ShiftHistoryRow[];
  staffOptions: StaffOption[];
  teams: Team[];
  shiftRequests: ShiftRequestRow[];
  recruitments: RecruitmentRow[];
  clientRecruitments: ClientRecruitmentRow[];
  teeBalance: number;
  affordableMaxEntries: number;
  clients: { id: string; name: string }[];
  agencies: { id: string; name: string }[];
  selectedRelationshipId?: string;
  companyName: string;
  initialSelectedDate?: string;
}) {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState<string | null>(initialSelectedDate ?? null);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [showRecruitForm, setShowRecruitForm] = useState(false);
  const [sharingImage, setSharingImage] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);

  const todayStr = todayJst();

  // 取引先を絞る: 選ばれたIDをそのままteam同様クエリパラメータに載せる
  // （絞り込みロジック自体はlistShiftsForMonth側で関係の向きを見て振り分け
  // る）。PDF/画像のタイトルでは、依頼主/派遣会社どちらか＋チーム名も
  // 合わせて出す — 名前だけだと「Aチーム？取引先？」と分からないため。
  const relationshipTypeLabel = selectedRelationshipId
    ? (clients.some((c) => c.id === selectedRelationshipId) ? "依頼主" : "派遣会社")
    : undefined;
  const relationshipName = selectedRelationshipId
    ? (clients.find((c) => c.id === selectedRelationshipId)?.name ??
      agencies.find((a) => a.id === selectedRelationshipId)?.name)
    : undefined;
  const teamName = selectedTeamId ? teams.find((t) => t.id === selectedTeamId)?.name : undefined;
  const filterLabel =
    [teamName, relationshipTypeLabel && relationshipName ? `${relationshipTypeLabel}：${relationshipName}` : null]
      .filter(Boolean)
      .join("・") || undefined;

  function calendarUrl(overrides: { team?: string; rel?: string }) {
    const params = new URLSearchParams({ y: String(year), m: String(month) });
    const team = overrides.team !== undefined ? overrides.team : (selectedTeamId ?? "");
    const rel = overrides.rel !== undefined ? overrides.rel : (selectedRelationshipId ?? "");
    if (team) params.set("team", team);
    if (rel) params.set("rel", rel);
    return `?${params.toString()}`;
  }

  const filterQuery = selectedTeamId ? `&team=${selectedTeamId}` : selectedRelationshipId ? `&rel=${selectedRelationshipId}` : "";

  async function shareAsImage() {
    if (!shareRef.current || sharingImage) return;
    setSharingImage(true);
    try {
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(shareRef.current, { backgroundColor: "#ffffff", pixelRatio: 2 });
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

  // 業務内容の入力候補 — 過去に使われたタイトルを直近順に重複なく並べる
  // （recruitmentsはdate昇順で来るので反転するだけで近似的に「最近使った順」になる）。
  const recentTitles = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (let i = recruitments.length - 1; i >= 0 && out.length < 8; i--) {
      const t = recruitments[i].title.trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
    return out;
  }, [recruitments]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="font-serif-jp text-2xl font-bold">シフトカレンダー</h1>
          {/* チーム・依頼主・派遣会社を1つの絞り込みにまとめる。実運用では
              チーム＝契約先の依頼主がほぼ1:1なので、依頼主/派遣会社を選ぶ
              こと自体が実質そのチームの絞り込みも兼ねるという前提。 */}
          <select
            value={selectedTeamId ? `team:${selectedTeamId}` : selectedRelationshipId ? `rel:${selectedRelationshipId}` : ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith("team:")) router.push(calendarUrl({ team: v.slice(5), rel: "" }));
              else if (v.startsWith("rel:")) router.push(calendarUrl({ team: "", rel: v.slice(4) }));
              else router.push(calendarUrl({ team: "", rel: "" }));
            }}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm"
          >
            <option value="">全社（すべて表示）</option>
            {teams.length > 0 ? (
              <optgroup label="チーム">
                {teams.map((t) => (
                  <option key={t.id} value={`team:${t.id}`}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {clients.length > 0 ? (
              <optgroup label="依頼主">
                {clients.map((c) => (
                  <option key={c.id} value={`rel:${c.id}`}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {agencies.length > 0 ? (
              <optgroup label="派遣会社">
                {agencies.map((a) => (
                  <option key={a.id} value={`rel:${a.id}`}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/api/calendar/pdf?y=${year}&m=${month}${selectedTeamId ? `&team=${selectedTeamId}` : ""}${selectedRelationshipId ? `&rel=${selectedRelationshipId}` : ""}`}
            target="_blank"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0">
              <path
                d="M6 3h8l4 4v14a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path d="M14 3v4h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M8 12h8M8 15.5h8M8 18.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            PDF出力
          </Link>
          <button
            type="button"
            disabled={sharingImage}
            onClick={shareAsImage}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs hover:border-primary hover:text-primary disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0">
              <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="8.5" cy="9.5" r="1.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M4 17l5-5 3 3 4-5 4 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {sharingImage ? "画像を作成中…" : "画像でシフトを共有"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4">
      <div className="mb-2 flex items-center justify-center gap-2">
        <Link
          href={`?y=${prev.y}&m=${prev.m}${filterQuery}`}
          aria-label="前の月"
          className="rounded-full p-2 text-muted hover:bg-background hover:text-primary"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <Link
          href={`?y=${todayStr.slice(0, 4)}&m=${Number(todayStr.slice(5, 7))}${filterQuery}`}
          className="rounded-lg px-2 py-1 font-serif-jp text-lg font-bold hover:bg-background"
        >
          {year}年{month}月
        </Link>
        <Link
          href={`?y=${next.y}&m=${next.m}${filterQuery}`}
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
          // 自社勤務・依頼主向け勤務のどちらも「こちらが作成/確定させたシフト」
          // という点で同じなので、緑のスタッフ名タグとして同じ枠内に表示する
          // （依頼主で絞り込みたい時はカレンダー上部の絞り込みを使う）。
          const confirmedShifts = dayShifts.filter((s) => s.source === "INHOUSE" || s.source === "CLIENT");
          const dayRecruitments = recruitments.filter((r) => r.date === c.dateStr && r.status === "PUBLISHED");
          const recruitingCount = dayRecruitments.filter((r) => r.filled < r.maxEntries).length;
          // オーダー＝依頼主が出した募集（本アカウントで繋がっている依頼主が
          // 出した求人）。こちらが作成したシフトはオーダーには含めない。
          const dayClientOrders = clientRecruitments.filter((r) => r.date === c.dateStr && r.filled < r.maxEntries);
          const dayShiftRequests = shiftRequestsByDate.get(c.dateStr) ?? [];
          const isToday = c.dateStr === todayStr;
          const isSelected = c.dateStr === selectedDate;

          const recruitTag: TagEntry | null =
            recruitingCount > 0
              ? { kind: "solid", id: "recruit", label: `募集中${recruitingCount}件`, className: "bg-amber-100 text-amber-900" }
              : null;
          const orderTag: TagEntry | null =
            dayClientOrders.length > 0
              ? { kind: "solid", id: "client-order", label: `オーダー${dayClientOrders.length}件`, className: "bg-sky-100 text-sky-900" }
              : null;

          // Fixed row budget of 5 total: 未確定・募集中・オーダー (1 row each,
          // only when there's something to show that day) — confirmed-shift
          // names get whatever's left, so a day with none of those can show
          // up to 5 names instead of being capped regardless.
          const unconfirmedTag: TagEntry | null =
            dayShiftRequests.length > 0
              ? { kind: "solid", id: "unconfirmed", label: `未確定${dayShiftRequests.length}件`, className: "bg-rose-100 text-rose-900" }
              : null;

          const reservedRows = (unconfirmedTag ? 1 : 0) + (recruitTag ? 1 : 0) + (orderTag ? 1 : 0);
          const confirmedSlotBudget = 5 - reservedRows;
          const visibleConfirmed = confirmedShifts.slice(0, confirmedSlotBudget);
          const hasOverflow = confirmedShifts.length > confirmedSlotBudget;

          const tagEntries: TagEntry[] = [
            ...visibleConfirmed.map((s) => ({
              kind: "solid" as const,
              id: s.id,
              label: s.staffName,
              className: "bg-emerald-100 text-emerald-900",
            })),
            ...(unconfirmedTag ? [unconfirmedTag] : []),
            ...(recruitTag ? [recruitTag] : []),
            ...(orderTag ? [orderTag] : []),
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
                  title={`他${confirmedShifts.length - confirmedSlotBudget}件`}
                  className="absolute right-0 top-0 h-0 w-0 border-r-[14px] border-b-[14px] border-r-accent border-b-transparent"
                />
              ) : null}
              <div className="mt-px flex flex-col gap-[2px]">
                {tagEntries.map((tag) => (
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

      {/* 画像共有用の非表示コンテンツ — PDF出力と同じ日別リスト構成にして、
          共有される「中身」が画像/PDFで一致するようにする（オンスクリーンの
          月グリッドは1日5件までの表示に切り詰められるため、そのままキャプ
          チャすると中身が食い違ってしまう）。 */}
      <div style={{ position: "fixed", top: 0, left: "-9999px" }} aria-hidden>
        <div ref={shareRef}>
          <ShareableShiftList companyName={companyName} year={year} month={month} filterLabel={filterLabel} shifts={shifts} />
        </div>
      </div>

      {selectedDate ? (
        <DayDetailModal
          dateStr={selectedDate}
          shifts={selectedShifts}
          history={shiftHistory.filter((h) => h.date === selectedDate)}
          recruitments={recruitments.filter((r) => r.date === selectedDate)}
          clientOrders={clientRecruitments.filter((r) => r.date === selectedDate)}
          staffOptions={staffOptions}
          affordableMaxEntries={affordableMaxEntries}
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
          recentTitles={recentTitles}
          onClose={() => setShowRecruitForm(false)}
        />
      ) : null}

      <ShiftRequestsSection requests={shiftRequests} teams={teams} />
    </div>
  );
}

// PDF出力(CalendarPdfDocument)と同じ日別リスト構成 — スタッフ名／時間／
// 取引先（自社ならその旨）を、切り詰めなしで並べる。画像共有はこのDOMを
// キャプチャすることで、PDFと共有画像の「中身」を一致させる。
function ShareableShiftList({
  companyName,
  year,
  month,
  filterLabel,
  shifts,
}: {
  companyName: string;
  year: number;
  month: number;
  filterLabel?: string;
  shifts: ShiftRow[];
}) {
  const byDate = new Map<string, ShiftRow[]>();
  for (const s of shifts) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date)!.push(s);
  }
  const dates = Array.from(byDate.keys()).sort();
  const issuedAt = todayJst();

  return (
    <div className="w-[800px] bg-white p-8 text-sm text-foreground">
      <p className="font-serif-jp text-xl font-bold text-primary">シフト表</p>
      <p className="mb-4 text-xs text-muted">
        {companyName} ／ 対象月: {year}年{month}月 ／ 発行日: {issuedAt}
        {filterLabel ? ` ／ 絞り込み: ${filterLabel}` : ""}
      </p>
      {dates.length === 0 ? (
        <p className="py-10 text-center text-muted">この月のシフトはありません。</p>
      ) : (
        dates.map((date) => {
          const d = new Date(date + "T00:00:00Z");
          const rows = byDate.get(date)!;
          return (
            <div key={date} className="mb-3">
              <div className="flex items-center justify-between bg-background px-2 py-1 font-semibold">
                <span>
                  {d.getUTCMonth() + 1}月{d.getUTCDate()}日（{WEEKDAYS[d.getUTCDay()]}）
                </span>
                <span>{rows.length}件</span>
              </div>
              {rows.map((s) => (
                <div key={s.id} className="flex items-center justify-between border-b border-border/50 px-2 py-1.5">
                  <span className="w-2/5">{s.staffName}</span>
                  <span className="w-1/3 text-muted">
                    {s.isUndecided ? "未定" : s.isAllDay ? "終日" : `${s.startTime}〜${s.endTime}`}
                  </span>
                  <span className="w-1/4 text-right text-muted">{s.clientName ?? "自社"}</span>
                </div>
              ))}
            </div>
          );
        })
      )}
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
  const menuRef = useClickOutside<HTMLDivElement>(open, () => setOpen(false));

  return (
    <div ref={menuRef} className="fixed bottom-8 right-8 z-20 flex flex-col items-end gap-2">
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
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-primary">
              <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
              <path d="M3 9h18" stroke="currentColor" strokeWidth="1.8" />
              <path d="M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            シフトを作成
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onCreateRecruitment();
            }}
            className="flex w-full items-center gap-2 border-t border-border px-4 py-3 text-left text-sm hover:bg-background"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-primary">
              <path
                d="M3 10v4a1 1 0 001 1h2l3 4V5L6 9H4a1 1 0 00-1 1z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path d="M11 6.5l7-3v17l-7-3" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M7 15v2.5a1.5 1.5 0 003 0V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            募集を作成
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
  history,
  recruitments,
  clientOrders,
  staffOptions,
  affordableMaxEntries,
  onNavigate,
  onClose,
}: {
  dateStr: string;
  shifts: ShiftRow[];
  history: ShiftHistoryRow[];
  recruitments: RecruitmentRow[];
  clientOrders: ClientRecruitmentRow[];
  staffOptions: StaffOption[];
  affordableMaxEntries: number;
  onNavigate: (dateStr: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"shifts" | "client" | "recruit">("shifts");
  const [editingRecruitmentId, setEditingRecruitmentId] = useState<string | null>(null);
  const isPastDay = dateStr < todayJst();
  const remaining = recruitments.reduce((sum, r) => sum + Math.max(r.maxEntries - r.filled, 0), 0);
  const hasUnreported = shifts.some((s) => isReportOverdue(s));

  const date = new Date(dateStr + "T00:00:00Z");
  const weekdayLabel = WEEKDAYS[date.getUTCDay()];
  const dateLabel = `${date.getUTCMonth() + 1}月${date.getUTCDate()}日（${weekdayLabel}）`;

  function shift(days: number) {
    const d = new Date(dateStr + "T00:00:00Z");
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
          {clientOrders.length > 0 ? (
            <button
              type="button"
              onClick={() => setTab("client")}
              className={`border-b-2 px-1 py-2 font-semibold ${tab === "client" ? "border-accent text-primary" : "border-transparent text-muted"}`}
            >
              オーダー
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
          <>
          {shifts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">この日のシフトはありません。</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {shifts.map((s) => {
                const workplaceLabel = s.source === "CLIENT" ? (s.clientName ?? "依頼主") : (s.originLabel ?? "自社");
                return (
                  <li
                    key={s.id}
                    className="grid grid-cols-[1fr_120px_80px_auto] items-center gap-2 border-b border-border/50 py-2.5 last:border-b-0"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{s.staffName}</span>
                      <span className="flex items-center gap-1.5 text-xs text-muted">
                        <span
                          title={workplaceLabel}
                          className={`max-w-[220px] truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                            s.source === "CLIENT" ? "bg-sky-100 text-sky-800" : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {workplaceLabel}
                        </span>
                        {s.note ? <span className="truncate">（{s.note}）</span> : null}
                      </span>
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
                    {isPastDay ? null : <CancelShiftButton shiftId={s.id} staffName={s.staffName} />}
                  </li>
                );
              })}
            </ul>
          )}
          <ShiftHistorySection history={history} />
          </>
        ) : tab === "client" ? (
          clientOrders.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">この日のオーダーはありません。</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {clientOrders.map((o) => (
                <ClientOrderRow
                  key={o.id}
                  order={o}
                  history={history.filter((h) => h.publicRecruitmentId === o.id)}
                  staffOptions={staffOptions}
                  disabled={isPastDay}
                />
              ))}
            </ul>
          )
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {recruitments.map((r) => (
              <OrderCard
                key={r.id}
                recruitment={r}
                assignedShifts={shifts.filter((s) => s.publicRecruitmentId === r.id)}
                history={history.filter((h) => h.publicRecruitmentId === r.id)}
                staffOptions={staffOptions}
                isPastDay={isPastDay}
                onEdit={() => setEditingRecruitmentId(r.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {editingRecruitmentId ? (
        <OrderEditModal
          recruitment={recruitments.find((r) => r.id === editingRecruitmentId)!}
          affordableMaxEntries={affordableMaxEntries}
          isPastDay={isPastDay}
          onClose={() => setEditingRecruitmentId(null)}
        />
      ) : null}
    </div>
  );
}

const RECRUITMENT_STATUS_LABEL: Record<string, string> = {
  PUBLISHED: "掲載中",
  DRAFT: "下書き",
  STOPPED: "停止中",
  DELETED: "削除済み",
};

const RECRUITMENT_QUICK_ADD_ITEMS = ["応募条件", "服装", "持ち物", "集合場所"];

// オーダー/公開募集カードの編集用ポップアップ。内容編集・削除・停止・
// 公開募集への切り替えをここに集約する（以前はカレンダー下部に別パネルが
// あり、人数上限の変更もブラウザのprompt()頼みだった）。
function OrderEditModal({
  recruitment,
  affordableMaxEntries,
  isPastDay,
  onClose,
}: {
  recruitment: RecruitmentRow;
  affordableMaxEntries: number;
  isPastDay: boolean;
  onClose: () => void;
}) {
  const [maxEntries, setMaxEntries] = useState(recruitment.maxEntries);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showPublicForm, setShowPublicForm] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [wageAmount, setWageAmount] = useState(recruitment.hourlyWage ? String(recruitment.hourlyWage) : "");
  const [wageType, setWageType] = useState<"HOURLY" | "DAILY">((recruitment.wageType as "HOURLY" | "DAILY") || "HOURLY");
  const [extraItems, setExtraItems] = useState<{ label: string; value: string }[]>(recruitment.extraItems);
  const [customItemLabel, setCustomItemLabel] = useState("");
  const [customItemValue, setCustomItemValue] = useState("");
  const [showCustomItemForm, setShowCustomItemForm] = useState(false);
  const [agreedScope, setAgreedScope] = useState(false);
  const [agreedAccuracy, setAgreedAccuracy] = useState(false);
  const [agreedLiability, setAgreedLiability] = useState(false);

  const remaining = Math.max(recruitment.maxEntries - recruitment.filled, 0);
  const canManage = recruitment.status === "PUBLISHED" && !isPastDay;
  const allAgreed = agreedScope && agreedAccuracy && agreedLiability;

  function addItem(label: string, value = "") {
    setExtraItems((prev) => (prev.some((i) => i.label === label) ? prev : [...prev, { label, value }]));
  }
  function updateItemValue(label: string, value: string) {
    setExtraItems((prev) => prev.map((i) => (i.label === label ? { ...i, value } : i)));
  }
  function removeItem(label: string) {
    setExtraItems((prev) => prev.filter((i) => i.label !== label));
  }

  function saveMaxEntries() {
    setError(null);
    startTransition(async () => {
      try {
        await updateMaxEntriesAction(recruitment.id, maxEntries);
      } catch {
        setError("変更できませんでした。");
      }
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteRecruitmentAction(recruitment.id);
        onClose();
      } catch {
        setError("削除できませんでした。");
      }
    });
  }

  function switchToPublic() {
    setError(null);
    startTransition(async () => {
      try {
        await openRecruitmentToPublicAction({
          recruitmentId: recruitment.id,
          remaining,
          hourlyWage: Number(wageAmount),
          wageType,
          extraItems,
        });
        onClose();
      } catch {
        setError("公開募集の開始に失敗しました（残高不足の可能性があります）。");
      }
    });
  }

  function saveDraft() {
    setError(null);
    startTransition(async () => {
      try {
        await saveRecruitmentPublicDraftAction({
          recruitmentId: recruitment.id,
          hourlyWage: wageAmount ? Number(wageAmount) : undefined,
          wageType,
          extraItems,
        });
        onClose();
      } catch {
        setError("保存できませんでした。");
      }
    });
  }

  return (
    <Modal title={recruitment.title} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
            {RECRUITMENT_STATUS_LABEL[recruitment.status] ?? recruitment.status}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              recruitment.visibility === "PUBLIC" ? "bg-sky-100 text-sky-800" : "bg-emerald-100 text-emerald-800"
            }`}
          >
            {recruitment.visibility === "PUBLIC" ? "公開募集" : "募集"}
          </span>
        </div>
        <p className="text-xs text-muted">
          {recruitment.date} {recruitment.startTime ?? (recruitment.isUndecided ? "未定" : "終日")}
          {recruitment.startTime ? `〜${recruitment.endTime}` : ""}
        </p>
        {recruitment.note ? <p className="text-xs text-muted">備考：{recruitment.note}</p> : null}

        {recruitment.visibility === "PUBLIC" ? (
          <div className="rounded-lg border border-border bg-background p-3 text-xs text-muted">
            <p>
              {recruitment.wageType === "DAILY" ? "日給" : "時給"} {recruitment.hourlyWage}円
            </p>
            {recruitment.extraItems.map((item) => (
              <p key={item.label} className="mt-1">
                {item.label}：{item.value}
              </p>
            ))}
          </div>
        ) : null}

        {!showPublicForm ? (
          <Field label="募集人数の上限">
            <div className="flex gap-2">
              <input
                type="number"
                min={recruitment.filled}
                value={maxEntries}
                disabled={!canManage}
                onChange={(e) => setMaxEntries(Number(e.target.value))}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm disabled:bg-gray-50"
              />
              {canManage ? (
                <button
                  type="button"
                  disabled={pending || maxEntries === recruitment.maxEntries}
                  onClick={saveMaxEntries}
                  className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-background disabled:opacity-50"
                >
                  変更する
                </button>
              ) : null}
            </div>
          </Field>
        ) : null}

        {error ? <p className="text-xs text-red-600">{error}</p> : null}

        {!canManage ? (
          recruitment.status === "PUBLISHED" ? (
            <p className="text-xs text-muted">過去の日付のため変更できません。</p>
          ) : null
        ) : showPublicForm ? (
          <div className="rounded-lg border border-accent/40 bg-accent/5 p-4">
            <p className="font-serif-jp text-base font-bold text-primary">公開募集の設定</p>
            <p className="mb-3 text-xs text-muted">所属登録していないTeeRA利用者へも募集を公開します</p>

            <div className="mb-3 rounded-lg border border-border bg-white p-3">
              <p className="mb-1 text-[10px] font-semibold text-muted">公開する募集</p>
              <p className="text-sm font-semibold">
                {recruitment.date} {recruitment.startTime ?? "終日"}
                {recruitment.startTime ? `〜${recruitment.endTime}` : ""}
              </p>
              <p className="text-sm">{recruitment.title}</p>
            </div>

            <div className="mb-3 flex items-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-primary-foreground">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-primary">
                Tee
              </span>
              <p className="text-xs">
                公開募集は課金制です。<span className="font-semibold">1名10Tee</span>がかかります
              </p>
            </div>

            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent/10 p-3">
              <p className="text-xs text-foreground">
                現在の残高では最大{affordableMaxEntries}名まで募集が可能です。{affordableMaxEntries + 1}
                名以上募集を希望する場合はチャージしてください。
              </p>
              <Link
                href="/company/wallet"
                className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                チャージする
              </Link>
            </div>

            <Field label="時給／日給" className="mb-2">
              <div className="flex gap-2">
                <select
                  value={wageType}
                  onChange={(e) => setWageType(e.target.value as "HOURLY" | "DAILY")}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <option value="HOURLY">時給</option>
                  <option value="DAILY">日給</option>
                </select>
                <input
                  type="number"
                  value={wageAmount}
                  onChange={(e) => setWageAmount(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                />
              </div>
            </Field>

            <p className="mb-1 text-xs font-semibold text-foreground">募集の詳細（任意）</p>
            <p className="mb-2 text-[11px] text-muted">
              この内容は所属していない方向けの表示です。所属登録済みのスタッフには表示されません
            </p>

            {extraItems.length > 0 ? (
              <div className="mb-2 flex flex-col gap-2">
                {extraItems.map((item) => (
                  <div key={item.label} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 truncate text-xs text-muted">{item.label}</span>
                    <input
                      type="text"
                      value={item.value}
                      onChange={(e) => updateItemValue(item.label, e.target.value)}
                      placeholder="内容"
                      className="flex-1 rounded-lg border border-border px-2 py-1.5 text-sm"
                    />
                    <button type="button" onClick={() => removeItem(item.label)} className="text-red-600">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {showCustomItemForm ? (
              <div className="mb-2 flex items-center gap-2">
                <input
                  type="text"
                  value={customItemLabel}
                  onChange={(e) => setCustomItemLabel(e.target.value)}
                  placeholder="項目名"
                  className="w-24 rounded-lg border border-border px-2 py-1.5 text-sm"
                />
                <input
                  type="text"
                  value={customItemValue}
                  onChange={(e) => setCustomItemValue(e.target.value)}
                  placeholder="内容（任意）"
                  className="flex-1 rounded-lg border border-border px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  disabled={!customItemLabel.trim()}
                  onClick={() => {
                    addItem(customItemLabel.trim(), customItemValue);
                    setCustomItemLabel("");
                    setCustomItemValue("");
                    setShowCustomItemForm(false);
                  }}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                >
                  追加
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCustomItemForm(false);
                    setCustomItemLabel("");
                    setCustomItemValue("");
                  }}
                  className="text-muted"
                >
                  ✕
                </button>
              </div>
            ) : null}

            <div className="mb-3 flex flex-wrap gap-2">
              {RECRUITMENT_QUICK_ADD_ITEMS.map((label) => {
                const added = extraItems.some((i) => i.label === label);
                return (
                  <button
                    key={label}
                    type="button"
                    disabled={added}
                    onClick={() => addItem(label)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                      added
                        ? "border-border text-muted/50"
                        : "border-primary/50 text-primary hover:border-primary hover:bg-primary/5"
                    }`}
                  >
                    ＋{label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setShowCustomItemForm(true)}
                className="rounded-full border border-dashed border-primary/50 px-3 py-1 text-xs font-medium text-primary hover:border-primary hover:bg-primary/5"
              >
                ＋項目を追加
              </button>
            </div>

            <p className="mb-2 text-xs text-muted">
              残り{remaining}名 × 10 Tee = {remaining * 10} Tee がロックされます（残高で賄える上限: {affordableMaxEntries}名）。
            </p>
            {remaining > affordableMaxEntries ? (
              <p className="mb-2 text-xs text-red-600">Tee残高が不足しているため開始できません。</p>
            ) : null}

            <p className="mb-2 text-xs font-semibold text-foreground">公開前の確認事項</p>
            <div className="mb-3 flex flex-col gap-2">
              <label className="flex items-start gap-2 rounded-lg border border-border bg-white p-3">
                <input
                  type="checkbox"
                  checked={agreedScope}
                  onChange={(e) => setAgreedScope(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-xs">
                  <span className="mb-1 block font-semibold">公開範囲について</span>
                  この募集は、貴社に所属登録していないTeeRA利用者に対しても広く公開されます。公開後は掲載内容が不特定多数の利用者の目に触れることを前提とし、業務内容・場所・時間などの記載に誤りや誤解を招く表現がないことを十分に確認したうえで公開するものとします。
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-border bg-white p-3">
                <input
                  type="checkbox"
                  checked={agreedAccuracy}
                  onChange={(e) => setAgreedAccuracy(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-xs">
                  <span className="mb-1 block font-semibold">掲載条件の正確性について</span>
                  掲載する募集内容（業務内容・勤務時間・報酬など）は、応募者との間で成立する労働条件の基礎となります。記載した報酬・時給・交通費等の条件について、実際の支払条件と齟齬がないこと、法令上求められる条件（最低賃金など）を満たしていることを貴社の責任において確認し、公開後の一方的な不利益変更は行わないものとします。
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-border bg-white p-3">
                <input
                  type="checkbox"
                  checked={agreedLiability}
                  onChange={(e) => setAgreedLiability(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-xs">
                  <span className="mb-1 block font-semibold">TeeRAの責任範囲について</span>
                  TeeRAは募集内容の掲載の場を提供するにとどまり、応募者の適性・信頼性の保証、および貴社と応募者との間で締結される業務条件・労働条件についての当事者にはなりません。応募者が募集内容と合致しなかった場合の対応、報酬・給与の支払いおよびそれに関するトラブルについて、TeeRAは一切の責任を負わないことに同意します。
                </span>
              </label>
            </div>

            <button
              type="button"
              disabled={pending || !wageAmount || remaining > affordableMaxEntries || !allAgreed}
              onClick={switchToPublic}
              className="mb-2 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              公開募集を開始する
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={saveDraft}
              className="mb-2 w-full rounded-lg border border-border px-4 py-2.5 text-sm font-semibold hover:bg-background disabled:opacity-50"
            >
              内容だけ保存する（まだ公開しない）
            </button>
            <button
              type="button"
              onClick={() => setShowPublicForm(false)}
              className="w-full text-center text-xs text-muted hover:text-primary"
            >
              キャンセル
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            {recruitment.visibility === "ORDER" ? (
              <button
                type="button"
                onClick={() => setShowPublicForm(true)}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0">
                  <path
                    d="M3 10v4a1 1 0 001 1h2l3 4V5L6 9H4a1 1 0 00-1 1z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                  <path d="M11 6.5l7-3v17l-7-3" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  <path d="M7 15v2.5a1.5 1.5 0 003 0V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                公開募集に切り替える
              </button>
            ) : null}
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmingDelete(true)}
              className="text-center text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
            >
              この募集を削除する
            </button>
          </div>
        )}
      </div>

      {confirmingDelete ? (
        <Modal title="この募集を削除しますか？" onClose={() => setConfirmingDelete(false)}>
          <p className="mb-4 text-sm text-muted">
            {recruitment.filled > 0
              ? `${recruitment.filled}名エントリーしています。削除するとエントリーもすべて取り消しになります。`
              : "この操作は元に戻せません。"}
          </p>
          {error ? <p className="mb-2 text-xs text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm"
            >
              キャンセル
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={remove}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              削除する
            </button>
          </div>
        </Modal>
      ) : null}
    </Modal>
  );
}

function OrderCard({
  recruitment: r,
  assignedShifts,
  history,
  staffOptions,
  isPastDay,
  onEdit,
}: {
  recruitment: RecruitmentRow;
  assignedShifts: ShiftRow[];
  history: ShiftHistoryRow[];
  staffOptions: StaffOption[];
  isPastDay: boolean;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showAssign, setShowAssign] = useState(false);
  const remaining = Math.max(r.maxEntries - r.filled, 0);

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <p className="font-semibold">{r.title}</p>
            {r.visibility === "PUBLIC" ? (
              <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
                公開募集
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted">
            {r.startTime ?? (r.isUndecided ? "未定" : "終日")}
            {r.startTime ? `〜${r.endTime}` : ""}
          </p>
          {r.note ? <p className="text-xs text-muted">備考：{r.note}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
            {r.filled}/{r.maxEntries}
          </span>
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold hover:bg-background"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
              <path
                d="M13.5 3.5L16.5 6.5L7 16H4V13L13.5 3.5Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
            編集
          </button>
        </div>
      </div>

      {assignedShifts.length > 0 ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-muted hover:text-primary"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
            >
              <path
                d="M5 7.5L10 12.5L15 7.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            確定スタッフ（{assignedShifts.length}名）
          </button>
          {expanded ? (
            <ul className="mt-1 flex flex-col text-xs">
              {assignedShifts.map((s) => {
                const affiliation = s.originLabel && s.originLabel !== "自社" ? s.originLabel : null;
                return (
                  <li
                    key={s.id}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-border/50 py-1.5 last:border-b-0"
                  >
                    <span className="truncate font-medium">{s.staffName}</span>
                    <span className="text-muted">{affiliation ?? ""}</span>
                    {!isPastDay ? <CancelShiftButton shiftId={s.id} staffName={s.staffName} /> : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      {r.status === "PUBLISHED" && !isPastDay && remaining > 0 ? (
        <button
          type="button"
          onClick={() => setShowAssign(true)}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-background"
        >
          ＋ スタッフを追加
        </button>
      ) : r.status === "PUBLISHED" && isPastDay ? (
        <p className="mt-2 text-xs text-muted">過去の日付のため変更できません。</p>
      ) : null}

      {showAssign ? (
        <MultiAssignModal
          recruitmentId={r.id}
          remaining={remaining}
          staffOptions={staffOptions}
          excludeIds={assignedShifts.map((s) => s.staffUserId)}
          onClose={() => setShowAssign(false)}
        />
      ) : null}

      <ShiftHistorySection history={history} />
    </li>
  );
}

// キャンセル・上書きで外れたスタッフを、カード下部に薄い折りたたみで表示する
// 共通パーツ（募集一覧のオーダーカード／オーダータブの依頼主別カード／
// スタッフシフトタブの3か所で使う）。履歴が無いカードには何も出さない。
function ShiftHistorySection({ history }: { history: ShiftHistoryRow[] }) {
  const [expanded, setExpanded] = useState(false);
  if (history.length === 0) return null;

  return (
    <div className="mt-2 border-t border-border/50 pt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-muted/70 hover:text-muted"
      >
        <svg viewBox="0 0 20 20" fill="none" className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}>
          <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        変更履歴（{history.length}件）
      </button>
      {expanded ? (
        <ul className="mt-1 flex flex-col gap-0.5">
          {history.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 text-[11px] text-muted/70">
              <span>{h.staffName}</span>
              <span className="text-right">
                {h.originLabel ? `（${h.originLabel}） ` : ""}
                {SHIFT_HISTORY_LABEL[h.status] ?? h.status}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// 複数のスタッフをチェックボックスで選び、順番にアサインしていくポップアップ。
// 重複が見つかった相手だけその場で「スキップ」か「重複を確認のうえ追加」を
// 選ばせ、解決したら次のスタッフへ自動的に進む。
function MultiAssignModal({
  recruitmentId,
  remaining,
  staffOptions,
  excludeIds,
  onClose,
}: {
  recruitmentId: string;
  remaining: number;
  staffOptions: StaffOption[];
  excludeIds: string[];
  onClose: () => void;
}) {
  const eligible = staffOptions.filter((s) => !excludeIds.includes(s.id));
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<"select" | "done">("select");
  const [pending, startTransition] = useTransition();
  const [results, setResults] = useState<{ name: string; ok: boolean }[]>([]);
  const [conflicts, setConflicts] = useState<{ id: string; startTime: string | null; endTime: string | null }[] | null>(
    null,
  );
  const [overrideChecked, setOverrideChecked] = useState(false);
  const [conflictTargetName, setConflictTargetName] = useState<string | null>(null);
  const targetsRef = useRef<StaffOption[]>([]);
  const indexRef = useRef(0);
  const doneRef = useRef<{ name: string; ok: boolean }[]>([]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < remaining) next.add(id);
      return next;
    });
  }

  function processFrom(index: number) {
    const targets = targetsRef.current;
    if (index >= targets.length) {
      setResults(doneRef.current);
      setPhase("done");
      return;
    }
    indexRef.current = index;
    const target = targets[index];
    startTransition(async () => {
      try {
        const result = await assignStaffToRecruitmentAction({ recruitmentId, staffUserId: target.id });
        if (result.status === "conflict") {
          setConflicts(result.conflicts);
          setConflictTargetName(target.name);
        } else {
          doneRef.current = [...doneRef.current, { name: target.name, ok: true }];
          processFrom(index + 1);
        }
      } catch {
        doneRef.current = [...doneRef.current, { name: target.name, ok: false }];
        processFrom(index + 1);
      }
    });
  }

  function startAssigning() {
    targetsRef.current = eligible.filter((s) => checked.has(s.id));
    doneRef.current = [];
    processFrom(0);
  }

  function resolveConflict(override: boolean) {
    const target = targetsRef.current[indexRef.current];
    if (!override) {
      doneRef.current = [...doneRef.current, { name: target.name, ok: false }];
      setConflicts(null);
      setConflictTargetName(null);
      setOverrideChecked(false);
      processFrom(indexRef.current + 1);
      return;
    }
    startTransition(async () => {
      try {
        const result = await assignStaffToRecruitmentAction({
          recruitmentId,
          staffUserId: target.id,
          overrideShiftIds: (conflicts ?? []).map((c) => c.id),
        });
        doneRef.current = [...doneRef.current, { name: target.name, ok: result.status === "created" }];
      } catch {
        doneRef.current = [...doneRef.current, { name: target.name, ok: false }];
      }
      setConflicts(null);
      setConflictTargetName(null);
      setOverrideChecked(false);
      processFrom(indexRef.current + 1);
    });
  }

  return (
    <Modal title="スタッフを追加" onClose={onClose}>
      {phase === "select" ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">残り{remaining}名まで選択できます。</p>
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {eligible.map((s) => (
              <li key={s.id}>
                <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-background">
                  <input
                    type="checkbox"
                    checked={checked.has(s.id)}
                    disabled={!checked.has(s.id) && checked.size >= remaining}
                    onChange={() => toggle(s.id)}
                  />
                  <span className="text-sm">{s.name}</span>
                </label>
              </li>
            ))}
            {eligible.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">追加できるスタッフがいません。</p>
            ) : null}
          </ul>

          {conflicts ? (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700">
              <p className="mb-1 font-semibold">{conflictTargetName}さんは他のシフトと重複しています。</p>
              <ul className="mb-2 list-disc pl-4">
                {conflicts.map((c) => (
                  <li key={c.id}>{c.startTime ? `${c.startTime}〜${c.endTime}` : "終日/未定"}</li>
                ))}
              </ul>
              <label className="mb-2 flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={overrideChecked}
                  onChange={(e) => setOverrideChecked(e.target.checked)}
                />
                スタッフ本人と確認済み
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => resolveConflict(false)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs"
                >
                  スキップ
                </button>
                <button
                  type="button"
                  disabled={pending || !overrideChecked}
                  onClick={() => resolveConflict(true)}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >
                  重複を確認のうえ追加する
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">
                キャンセル
              </button>
              <button
                type="button"
                disabled={pending || checked.size === 0}
                onClick={startAssigning}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {checked.size}名をアサインする
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="rounded-lg border border-border bg-background p-2 text-xs">
            {results.map((r, i) => (
              <p key={i} className={r.ok ? "text-muted" : "text-red-600"}>
                {r.name}：{r.ok ? "追加しました" : "追加できませんでした"}
              </p>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            閉じる
          </button>
        </div>
      )}
    </Modal>
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
        <Modal title="アサインの確認" onClose={() => setConfirming(false)}>
          <p className="mb-4 text-sm text-muted">{staffName}さんをこの枠にアサインします。よろしいですか？</p>
          {error ? <p className="mb-2 text-xs text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm"
            >
              キャンセル
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => assign()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              確定
            </button>
          </div>
        </Modal>
      ) : null}

      {conflicts ? (
        <Modal
          title="他のシフトと重複しています"
          onClose={() => {
            setConflicts(null);
            setConfirming(false);
          }}
        >
          <ul className="mb-3 list-disc pl-4 text-sm text-muted">
            {conflicts.map((c) => (
              <li key={c.id}>{c.startTime ? `${c.startTime}〜${c.endTime}` : "終日/未定"}</li>
            ))}
          </ul>
          <label className="mb-4 flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={overrideChecked} onChange={(e) => setOverrideChecked(e.target.checked)} />
            スタッフ本人と確認済み
          </label>
          {error ? <p className="mb-2 text-xs text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setConflicts(null);
                setConfirming(false);
              }}
              className="rounded-lg border border-border px-4 py-2 text-sm"
            >
              キャンセル
            </button>
            <button
              type="button"
              disabled={pending || !overrideChecked}
              onClick={() => assign(conflicts.map((c) => c.id))}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              重複を確認のうえアサインする
            </button>
          </div>
        </Modal>
      ) : null}

      {error && !confirming && !conflicts ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
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
  history,
  staffOptions,
  disabled,
}: {
  order: ClientRecruitmentRow;
  history: ShiftHistoryRow[];
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
      <ShiftHistorySection history={history} />
    </li>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-lg">
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

// 選択肢を大きくタップできるリスト項目として表示する（チーム/勤務先/スタッフの
// 各ステップで共通）。
function WizardOptionButton({
  label,
  sublabel,
  onClick,
}: {
  label: string;
  sublabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-xl border border-border bg-white px-4 py-3 text-left text-sm font-medium hover:border-primary hover:text-primary"
    >
      <span>
        {label}
        {sublabel ? <span className="ml-2 text-xs font-normal text-muted">{sublabel}</span> : null}
      </span>
      <span className="text-muted">›</span>
    </button>
  );
}

type AssignStep = "team" | "workplace" | "staff" | "datetime" | "confirm";

// シフト作成: チーム→勤務先(社内/依頼主)→スタッフ→日時、の順に1画面ずつ選ばせ
// てから最後に確認画面を出す（オーダー作成の確認画面と同じパターン）。
// チームは管理者ありきのシフト作成という位置づけのため必須（会社にチームが
// 1つもない場合のみ、このステップ自体を飛ばす — オーダー作成と同じ扱い）。
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
  const steps: AssignStep[] = [
    ...(teams.length > 0 ? (["team"] as const) : []),
    "workplace",
    "staff",
    "datetime",
    "confirm",
  ];
  const [step, setStep] = useState<AssignStep>(steps[0]);
  const [teamId, setTeamId] = useState("");
  const [companyRelationshipId, setCompanyRelationshipId] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [staffUserId, setStaffUserId] = useState("");
  const [dates, setDates] = useState<string[]>([defaultDate]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [isUndecided, setIsUndecided] = useState(false);
  const [note, setNote] = useState("");
  const [conflictsByDate, setConflictsByDate] = useState<
    { date: string; conflicts: { id: string; startTime: string | null; endTime: string | null }[] }[] | null
  >(null);
  const [overrideChecked, setOverrideChecked] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function goBack() {
    const i = steps.indexOf(step);
    if (i > 0) setStep(steps[i - 1]);
  }
  function goNext() {
    const i = steps.indexOf(step);
    if (i < steps.length - 1) setStep(steps[i + 1]);
  }

  // 確認画面で重複を検出した後、戻って日付や時間を変更したら、前回の重複
  // チェック結果は古くなるので破棄する（次の送信時にサーバー側で選び直した
  // 内容に対して再チェックされる）。
  function clearStaleConflicts() {
    setConflictsByDate(null);
    setOverrideChecked(false);
  }

  function toggleDate(d: string) {
    setDates((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
    clearStaleConflicts();
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const overridesByDate = conflictsByDate
          ? Object.fromEntries(conflictsByDate.map((c) => [c.date, c.conflicts.map((x) => x.id)]))
          : undefined;
        const result = await createAssignedShiftAction({
          teamId: teamId || undefined,
          staffUserId,
          dates,
          startTime: isUndecided ? null : startTime,
          endTime: isUndecided ? null : endTime,
          isAllDay: false,
          isUndecided,
          note: note || undefined,
          companyRelationshipId: companyRelationshipId || undefined,
          overridesByDate,
        });
        if (result.status === "conflict") {
          setConflictsByDate(result.conflictsByDate);
          setOverrideChecked(false);
        } else {
          onClose();
        }
      } catch {
        setError("作成に失敗しました。");
      }
    });
  }

  const teamName = teams.find((t) => t.id === teamId)?.name;
  const workplaceName = companyRelationshipId ? clients.find((c) => c.id === companyRelationshipId)?.name : "社内";
  const staffName = staffOptions.find((s) => s.id === staffUserId)?.name;
  const dateLabels = dates.map((d) => {
    const dt = new Date(d + "T00:00:00Z");
    return `${dt.getUTCMonth() + 1}月${dt.getUTCDate()}日（${WEEKDAYS[dt.getUTCDay()]}）`;
  });
  const filteredClients = clients.filter((c) => c.name.includes(clientSearch));

  const backButton =
    steps.indexOf(step) > 0 ? (
      <button type="button" onClick={goBack} className="-mt-1 self-start text-xs text-muted hover:text-primary">
        ＜ 戻る
      </button>
    ) : null;

  if (step === "team") {
    return (
      <Modal title="シフトを作成" onClose={onClose}>
        <div className="flex flex-col gap-3">
          <h3 className="font-serif-jp text-lg font-semibold">どのチームのシフトを作成しますか？</h3>
          <div className="flex flex-col gap-2">
            {teams.map((t) => (
              <WizardOptionButton
                key={t.id}
                label={t.name}
                onClick={() => {
                  setTeamId(t.id);
                  goNext();
                }}
              />
            ))}
          </div>
        </div>
      </Modal>
    );
  }

  if (step === "workplace") {
    return (
      <Modal title="シフトを作成" onClose={onClose}>
        <div className="flex flex-col gap-3">
          {backButton}
          <h3 className="font-serif-jp text-lg font-semibold">勤務先を選択</h3>
          <WizardOptionButton
            label="社内（自社スタッフとして勤務）"
            onClick={() => {
              setCompanyRelationshipId("");
              goNext();
            }}
          />
          {clients.length > 0 ? (
            <>
              <p className="mt-1 text-xs text-muted">依頼主から選択</p>
              <input
                type="text"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="依頼主名で検索"
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
              <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                {filteredClients.map((c) => (
                  <WizardOptionButton
                    key={c.id}
                    label={c.name}
                    onClick={() => {
                      setCompanyRelationshipId(c.id);
                      goNext();
                    }}
                  />
                ))}
              </div>
            </>
          ) : null}
        </div>
      </Modal>
    );
  }

  if (step === "staff") {
    return (
      <Modal title="シフトを作成" onClose={onClose}>
        <div className="flex flex-col gap-3">
          {backButton}
          <h3 className="font-serif-jp text-lg font-semibold">{workplaceName}・スタッフを選択</h3>
          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
            {staffOptions.map((s) => (
              <WizardOptionButton
                key={s.id}
                label={s.name}
                onClick={() => {
                  setStaffUserId(s.id);
                  goNext();
                }}
              />
            ))}
          </div>
        </div>
      </Modal>
    );
  }

  if (step === "datetime") {
    return (
      <Modal title="シフトを作成" onClose={onClose}>
        <div className="flex flex-col gap-3">
          {backButton}
          <h3 className="font-serif-jp text-lg font-semibold">
            {workplaceName}・{staffName}
          </h3>

          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={isUndecided}
              onChange={(e) => {
                setIsUndecided(e.target.checked);
                clearStaleConflicts();
              }}
            />
            時間未定
          </label>
          {!isUndecided ? (
            <div className="flex gap-2">
              <Field label="開始時刻">
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => {
                    setStartTime(e.target.value);
                    clearStaleConflicts();
                  }}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                />
              </Field>
              <Field label="終了時刻">
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => {
                    setEndTime(e.target.value);
                    clearStaleConflicts();
                  }}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                />
              </Field>
            </div>
          ) : null}

          <div className="flex flex-col gap-1 text-xs text-foreground/80">
            <span>日付を選択（複数選択可）</span>
            <MiniCalendarMultiSelect selected={dates} onToggle={toggleDate} initialDate={defaultDate} />
          </div>
          {dates.length === 0 ? (
            <p className="text-xs text-red-600">少なくとも1つ日付を選択してください。</p>
          ) : dates.length > 1 ? (
            <p className="text-xs text-muted">選んだ{dates.length}日分、同じ内容のシフトがそれぞれ作成されます。</p>
          ) : null}

          <Field label="備考（任意）">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </Field>

          <button
            type="button"
            disabled={dates.length === 0}
            onClick={goNext}
            className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            次へ
          </button>
        </div>
      </Modal>
    );
  }

  // step === "confirm"
  return (
    <Modal title="シフトを作成" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {backButton}
        <h3 className="font-serif-jp text-lg font-semibold">内容を確認してください</h3>

        <dl className="divide-y divide-border rounded-xl border border-border bg-background/40 text-sm">
          <div className="flex items-center justify-between px-4 py-3">
            <dt className="text-muted">スタッフ</dt>
            <dd className="font-medium">{staffName}</dd>
          </div>
          {teams.length > 0 ? (
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-muted">チーム</dt>
              <dd className="font-medium">{teamName ?? "指定なし"}</dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between px-4 py-3">
            <dt className="text-muted">勤務先</dt>
            <dd className="font-medium">{workplaceName}</dd>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <dt className="text-muted">時間</dt>
            <dd className="font-medium">{isUndecided ? "時間未定" : `${startTime}〜${endTime}`}</dd>
          </div>
          <div className="px-4 py-3">
            <dt className="mb-1 text-muted">日付（{dates.length}件）</dt>
            <dd className="flex flex-col gap-0.5 font-medium">
              {dateLabels.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </dd>
          </div>
          {note ? (
            <div className="px-4 py-3">
              <dt className="mb-1 text-muted">備考</dt>
              <dd className="font-medium whitespace-pre-wrap">{note}</dd>
            </div>
          ) : null}
        </dl>

        {conflictsByDate ? (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700">
            <p className="mb-2 font-semibold">他のシフトと重複している日があります。</p>
            <ul className="mb-2 list-disc pl-4">
              {conflictsByDate.map(({ date, conflicts }) => (
                <li key={date}>
                  {date}: {conflicts.map((c) => (c.startTime ? `${c.startTime}〜${c.endTime}` : "終日/未定")).join("、")}
                </li>
              ))}
            </ul>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={overrideChecked} onChange={(e) => setOverrideChecked(e.target.checked)} />
              スタッフ本人と確認済み
            </label>
          </div>
        ) : null}

        {error ? <p className="text-xs text-red-600">{error}</p> : null}

        <button
          type="button"
          disabled={pending || !staffUserId || dates.length === 0 || (conflictsByDate !== null && !overrideChecked)}
          onClick={() => submit()}
          className="rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {pending ? "作成中…" : conflictsByDate ? "重複を確認のうえ作成する" : `${dates.length}件のシフトを作成`}
        </button>
      </div>
    </Modal>
  );
}

// オーダーの新規作成 — 自社スタッフ・配属済み派遣スタッフだけが対象の、無料
// の募集。時給等の公開募集専用項目はここでは入力させない（公開募集への
// 切り替え時に別途入力する）。
// 月表示のミニカレンダーで複数日をトグル選択する。「日付を追加」の
// 1件ずつ入力より、カレンダー上で直接クリックできた方が速い。
function MiniCalendarMultiSelect({
  selected,
  onToggle,
  initialDate,
}: {
  selected: string[];
  onToggle: (dateStr: string) => void;
  initialDate: string;
}) {
  const [initialYear, initialMonth] = initialDate.split("-").map(Number);
  const [viewYear, setViewYear] = useState(initialYear);
  const [viewMonth, setViewMonth] = useState(initialMonth);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const todayStr = useMemo(() => todayJst(), []);

  const cells = useMemo(() => {
    const firstOfMonth = new Date(Date.UTC(viewYear, viewMonth - 1, 1));
    const startDow = firstOfMonth.getUTCDay();
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth, 0)).getUTCDate();
    const out: { dateStr: string | null; day: number | null }[] = [];
    for (let i = 0; i < startDow; i++) out.push({ dateStr: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${viewYear}-${String(viewMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      out.push({ dateStr, day: d });
    }
    return out;
  }, [viewYear, viewMonth]);

  function prevMonth() {
    if (viewMonth === 1) {
      setViewYear(viewYear - 1);
      setViewMonth(12);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }
  function nextMonth() {
    if (viewMonth === 12) {
      setViewYear(viewYear + 1);
      setViewMonth(1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={prevMonth} aria-label="前の月" className="p-1 text-muted hover:text-primary">
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="text-sm font-semibold">
          {viewYear}年{viewMonth}月
        </span>
        <button type="button" onClick={nextMonth} aria-label="次の月" className="p-1 text-muted hover:text-primary">
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="mb-1 grid grid-cols-7 text-center text-[11px] text-muted">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c.dateStr) return <span key={i} />;
          const isPast = c.dateStr < todayStr;
          return (
            <button
              key={c.dateStr}
              type="button"
              disabled={isPast}
              onClick={() => onToggle(c.dateStr!)}
              className={`rounded-lg py-1.5 text-xs ${
                isPast
                  ? "cursor-not-allowed text-muted/50"
                  : selectedSet.has(c.dateStr)
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "text-foreground hover:bg-background"
              }`}
            >
              {c.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RecruitmentFormModal({
  teams,
  defaultDate,
  recentTitles,
  onClose,
}: {
  teams: Team[];
  defaultDate: string;
  recentTitles: string[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [teamId, setTeamId] = useState("");
  const [dates, setDates] = useState<string[]>([defaultDate]);
  const [isUndecided, setIsUndecided] = useState(false);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [maxEntries, setMaxEntries] = useState(1);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "confirm">("form");
  const teamRequired = teams.length > 0;

  function toggleDate(d: string) {
    setDates((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await createPublicRecruitmentAction({
          teamId: teamId || undefined,
          title,
          note: note || undefined,
          dates,
          startTime: isUndecided ? undefined : startTime,
          endTime: isUndecided ? undefined : endTime,
          isUndecided,
          maxEntries,
        });
        onClose();
      } catch {
        setError("作成できませんでした。");
      }
    });
  }

  const teamName = teams.find((t) => t.id === teamId)?.name;
  const dateLabels = dates.map((d) => {
    const dt = new Date(d + "T00:00:00Z");
    return `${dt.getUTCMonth() + 1}月${dt.getUTCDate()}日（${WEEKDAYS[dt.getUTCDay()]}）`;
  });

  if (step === "confirm") {
    return (
      <Modal title="募集を作成" onClose={onClose}>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setStep("form")}
            className="-mt-1 self-start text-xs text-muted hover:text-primary"
          >
            ＜ 戻る
          </button>
          <h3 className="font-serif-jp text-lg font-semibold">内容を確認してください</h3>

          <dl className="divide-y divide-border rounded-xl border border-border bg-background/40 text-sm">
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-muted">業務内容</dt>
              <dd className="font-medium">{title}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-muted">チーム</dt>
              <dd className="font-medium">{teamName ?? "未選択"}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-muted">募集人数</dt>
              <dd className="font-medium">{maxEntries}名</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-muted">時間</dt>
              <dd className="font-medium">{isUndecided ? "未定" : `${startTime}〜${endTime}`}</dd>
            </div>
            <div className="px-4 py-3">
              <dt className="mb-1 text-muted">日付（{dates.length}件）</dt>
              <dd className="flex flex-col gap-0.5 font-medium">
                {dateLabels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </dd>
            </div>
            {note ? (
              <div className="px-4 py-3">
                <dt className="mb-1 text-muted">備考</dt>
                <dd className="font-medium whitespace-pre-wrap">{note}</dd>
              </div>
            ) : null}
          </dl>

          {error ? <p className="text-xs text-red-600">{error}</p> : null}

          <button
            type="button"
            disabled={pending}
            onClick={() => submit()}
            className="rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {pending ? "作成中…" : `${dates.length}件の募集を作成`}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="募集を作成" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="-mt-2 text-xs text-muted">自社での勤務を募集します</p>

        {teamRequired ? (
          <Field label="担当チーム">
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            >
              <option value="">チームを選択</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="業務内容">
          <input
            type="text"
            list="job-title-suggestions"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：倉庫での軽作業"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
          <datalist id="job-title-suggestions">
            {recentTitles.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>

        <Field label="募集人数">
          <input
            type="number"
            min={1}
            value={maxEntries}
            onChange={(e) => setMaxEntries(Number(e.target.value))}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isUndecided} onChange={(e) => setIsUndecided(e.target.checked)} />
          時間未定
        </label>
        {!isUndecided ? (
          <div className="flex gap-2">
            <Field label="開始時刻">
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
            </Field>
            <Field label="終了時刻">
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
            </Field>
          </div>
        ) : null}

        <div className="flex flex-1 flex-col gap-1 text-xs text-foreground/80">
          <span>日付を選択（複数選択可）</span>
          <MiniCalendarMultiSelect selected={dates} onToggle={toggleDate} initialDate={defaultDate} />
        </div>
        {dates.length === 0 ? (
          <p className="text-xs text-red-600">少なくとも1つ日付を選択してください。</p>
        ) : dates.length > 1 ? (
          <p className="text-xs text-muted">選んだ{dates.length}日分、同じ内容の募集がそれぞれ独立して作成されます。</p>
        ) : null}

        <Field label="備考（任意）">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="集合場所・服装・持ち物など"
            rows={3}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
        </Field>

        <p className="text-xs text-muted">
          自社スタッフ・配属済みの派遣スタッフのみが対象の募集として作成されます（無料）。応募が足りない場合は、あとから公開募集への切り替えができます。
        </p>

        {error ? <p className="text-xs text-red-600">{error}</p> : null}

        <button
          type="button"
          disabled={pending || !title || dates.length === 0 || (teamRequired && !teamId)}
          onClick={() => setStep("confirm")}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          掲載する
        </button>
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
