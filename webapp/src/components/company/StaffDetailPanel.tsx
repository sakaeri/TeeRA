"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getStaffMonthDetailAction, updateStaffNoteAction, inviteProxyUpgradeAction } from "@/app/company/actions";
import { addStaffTaskRateVersionAction, endStaffTaskRateAction } from "@/app/company/contracts/actions";
import { todayJstParts, todayJst } from "@/lib/date";

type StaffTaskRate = {
  id: string;
  taskName: string;
  currentLabel: string;
  versions: { id: string; label: string; effectiveFrom: string }[];
};

type StaffMonthDetail = {
  membershipId: string;
  name: string;
  isProxy: boolean;
  note: string;
  teams: { teamId: string; teamName: string }[];
  monthlyHours: number;
  daysWorked: number;
  contracts: {
    id: string;
    title: string;
    status: string;
    wageLabel: string;
    workplaceName: string;
    contractStartDate: string;
  }[];
  taskRates: StaffTaskRate[];
  days: {
    shiftId: string;
    date: string;
    startTime: string | null;
    endTime: string | null;
    isAllDay: boolean;
    isUndecided: boolean;
    approvalStatus: string | null;
    outcome: string | null;
  }[];
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

function timeLabel(d: StaffMonthDetail["days"][number]) {
  if (!d.approvalStatus) return "未提出";
  if (d.isUndecided) return "未定";
  if (d.isAllDay) return "終日";
  return `${d.startTime ?? "--:--"}〜${d.endTime ?? "--:--"}`;
}

export function StaffDetailPanel({ userId, onClose }: { userId: string; onClose: () => void }) {
  const router = useRouter();
  const initToday = todayJstParts();
  const [year, setYear] = useState(initToday.year);
  const [month, setMonth] = useState(initToday.month);
  const [tab, setTab] = useState<"history" | "contracts" | "rates" | "note">("history");
  const [data, setData] = useState<StaffMonthDetail | null>(null);
  const [noteValue, setNoteValue] = useState("");
  const [pending, startTransition] = useTransition();
  const [upgradeUrl, setUpgradeUrl] = useState<string | null>(null);

  function handleUpgrade() {
    startTransition(async () => {
      const url = await inviteProxyUpgradeAction(userId);
      setUpgradeUrl(url);
    });
  }

  function refresh() {
    return getStaffMonthDetailAction(userId, year, month).then((d) => {
      setData(d);
      setNoteValue(d.note);
    });
  }

  useEffect(() => {
    let cancelled = false;
    getStaffMonthDetailAction(userId, year, month).then((d) => {
      if (cancelled) return;
      setData(d);
      setNoteValue(d.note);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, year, month]);

  function shiftMonth(delta: number) {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth() + 1);
  }

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} className="mb-2 self-start text-sm text-muted">
          ← 閉じる
        </button>

        {!data ? (
          <p className="text-sm text-muted">読み込み中…</p>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif-jp text-xl font-bold">{data.name}</h2>
            </div>

            {data.isProxy ? (
              <div className="mb-4 rounded-lg border border-accent/40 bg-accent/10 p-3 text-xs">
                {upgradeUrl ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={upgradeUrl}
                      className="flex-1 rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-muted"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof navigator !== "undefined" && navigator.clipboard) {
                          navigator.clipboard.writeText(upgradeUrl).catch(() => {});
                        }
                      }}
                      className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                    >
                      コピー
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span>仮アカウントです。本人に招待URLを送って本アカウントと連携できます。</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={handleUpgrade}
                      className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      本アカウントと連携する
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            <div className="mb-4 flex flex-wrap gap-1">
              {data.teams.length === 0 ? (
                <span className="text-xs text-muted">チーム未所属</span>
              ) : (
                data.teams.map((t) => (
                  <span key={t.teamId} className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-900">
                    {t.teamName}
                  </span>
                ))
              )}
            </div>

            <div className="mb-4 flex gap-4 border-b border-border text-sm">
              <button
                type="button"
                onClick={() => setTab("history")}
                className={`border-b-2 px-1 py-2 font-semibold ${tab === "history" ? "border-accent text-primary" : "border-transparent text-muted"}`}
              >
                稼働履歴
              </button>
              <button
                type="button"
                onClick={() => setTab("contracts")}
                className={`border-b-2 px-1 py-2 font-semibold ${tab === "contracts" ? "border-accent text-primary" : "border-transparent text-muted"}`}
              >
                契約書管理
              </button>
              <button
                type="button"
                onClick={() => setTab("rates")}
                className={`border-b-2 px-1 py-2 font-semibold ${tab === "rates" ? "border-accent text-primary" : "border-transparent text-muted"}`}
              >
                業務内容単価
              </button>
              <button
                type="button"
                onClick={() => setTab("note")}
                className={`border-b-2 px-1 py-2 font-semibold ${tab === "note" ? "border-accent text-primary" : "border-transparent text-muted"}`}
              >
                情報メモ
              </button>
            </div>

            {tab === "history" ? (
              <div>
                <div className="mb-4 flex items-center justify-center gap-4">
                  <button type="button" onClick={() => shiftMonth(-1)} className="text-muted">
                    ‹
                  </button>
                  <span className="font-serif-jp font-bold">
                    {year}年{month}月
                  </span>
                  <button type="button" onClick={() => shiftMonth(1)} className="text-muted">
                    ›
                  </button>
                </div>

                <div className="mb-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted">稼働時間</p>
                    <p className="text-lg font-bold">{data.monthlyHours}h</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted">出勤日数</p>
                    <p className="text-lg font-bold">{data.daysWorked}日</p>
                  </div>
                  <div className="flex flex-col items-center justify-center rounded-lg border border-border p-3">
                    <p className="mb-1 text-xs text-muted">給料明細</p>
                    <button
                      type="button"
                      onClick={() => router.push(`/company/payroll?month=${year}-${String(month).padStart(2, "0")}&staff=${userId}`)}
                      className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
                    >
                      計算する
                    </button>
                  </div>
                </div>

                <ul className="flex flex-col gap-1">
                  {data.days.map((d) => (
                    <li key={d.shiftId} className="flex items-center justify-between border-b border-border/50 py-2 text-sm">
                      <span>{d.date}</span>
                      <span className="text-muted">{timeLabel(d)}</span>
                      {d.approvalStatus ? (
                        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${APPROVAL_PILL[d.approvalStatus]}`}>
                          {APPROVAL_LABEL[d.approvalStatus]}
                        </span>
                      ) : (
                        <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">未提出</span>
                      )}
                    </li>
                  ))}
                  {data.days.length === 0 ? <p className="py-6 text-center text-sm text-muted">この月のシフトはありません。</p> : null}
                </ul>
              </div>
            ) : null}

            {tab === "contracts" ? (
              <ul className="flex flex-col gap-2">
                {data.contracts.map((c) => (
                  <li key={c.id} className="rounded-lg border border-border p-3 text-sm">
                    <p className="font-semibold">{c.title}</p>
                    <p className="text-muted">
                      {c.workplaceName} ／ {c.wageLabel}
                    </p>
                    <p className="text-xs text-muted">雇用開始日: {c.contractStartDate}</p>
                    <p className="text-xs text-muted">{c.status === "ACTIVE" ? "確認済み" : "確認待ち"}</p>
                  </li>
                ))}
                {data.contracts.length === 0 ? <p className="py-6 text-center text-sm text-muted">契約書はありません。</p> : null}
              </ul>
            ) : null}

            {tab === "rates" ? <StaffTaskRatesTab userId={userId} rates={data.taskRates} onChanged={refresh} /> : null}

            {tab === "note" ? (
              <div className="flex flex-col gap-3">
                <textarea
                  value={noteValue}
                  onChange={(e) => setNoteValue(e.target.value)}
                  rows={8}
                  placeholder="このスタッフに関するメモを入力"
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => updateStaffNoteAction(data.membershipId, noteValue))}
                  className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  保存
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

const WAGE_TYPE_OPTIONS: { value: "HOURLY" | "DAILY" | "MONTHLY"; label: string }[] = [
  { value: "HOURLY", label: "時給" },
  { value: "DAILY", label: "日給" },
  { value: "MONTHLY", label: "月給" },
];

// 単価は上書きしない — 編集は新しいバージョンを開始日付きで積む、終了は
// 単価未設定（雇用契約の基本単価にフォールバック）に戻すバージョンを積む。
function StaffTaskRatesTab({
  userId,
  rates,
  onChanged,
}: {
  userId: string;
  rates: StaffTaskRate[];
  onChanged: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [amendingId, setAmendingId] = useState<string | null>(null);
  const [amendWageType, setAmendWageType] = useState<"HOURLY" | "DAILY" | "MONTHLY">("HOURLY");
  const [amendAmount, setAmendAmount] = useState("");
  const [amendEffectiveFrom, setAmendEffectiveFrom] = useState(todayJst());
  const [endingId, setEndingId] = useState<string | null>(null);
  const [endEffectiveFrom, setEndEffectiveFrom] = useState(todayJst());
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  const [newWageType, setNewWageType] = useState<"HOURLY" | "DAILY" | "MONTHLY">("HOURLY");
  const [newAmount, setNewAmount] = useState("");
  const [newEffectiveFrom, setNewEffectiveFrom] = useState(todayJst());

  function startAmend(r: StaffTaskRate) {
    setEndingId(null);
    setAmendingId(r.id);
    setAmendWageType("HOURLY");
    setAmendAmount("");
    setAmendEffectiveFrom(todayJst());
  }

  function submitAmend(r: StaffTaskRate) {
    if (!amendAmount) return;
    startTransition(async () => {
      await addStaffTaskRateVersionAction({
        staffUserId: userId,
        taskName: r.taskName,
        wageType: amendWageType,
        amount: Number(amendAmount),
        effectiveFrom: amendEffectiveFrom,
      });
      setAmendingId(null);
      await onChanged();
    });
  }

  function submitEnd(r: StaffTaskRate) {
    startTransition(async () => {
      await endStaffTaskRateAction(r.id, endEffectiveFrom);
      setEndingId(null);
      await onChanged();
    });
  }

  function submitNewTask() {
    if (!newTaskName.trim() || !newAmount) return;
    startTransition(async () => {
      await addStaffTaskRateVersionAction({
        staffUserId: userId,
        taskName: newTaskName.trim(),
        wageType: newWageType,
        amount: Number(newAmount),
        effectiveFrom: newEffectiveFrom,
      });
      setShowNewForm(false);
      setNewTaskName("");
      setNewAmount("");
      setNewEffectiveFrom(todayJst());
      await onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">未登録の業務内容は、雇用契約の基本単価で給与計算されます。</p>
      <ul className="flex flex-col gap-2">
        {rates.map((r) => (
          <li key={r.id} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{r.taskName}</span>
              <span className="text-muted">{r.currentLabel}</span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                className="text-muted hover:text-primary"
              >
                {expandedId === r.id ? "▲ 履歴を閉じる" : `▼ 履歴（${r.versions.length}件）`}
              </button>
              <button type="button" onClick={() => startAmend(r)} className="text-primary hover:underline">
                単価を変更
              </button>
              <button
                type="button"
                onClick={() => {
                  setAmendingId(null);
                  setEndingId(r.id);
                  setEndEffectiveFrom(todayJst());
                }}
                className="text-muted hover:text-red-600"
              >
                終了する
              </button>
            </div>

            {expandedId === r.id ? (
              <ul className="mt-2 flex flex-col text-xs text-muted">
                {r.versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between border-t border-border/50 py-1">
                    <span>{v.effectiveFrom} 〜</span>
                    <span>{v.label}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {amendingId === r.id ? (
              <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-2">
                <select
                  value={amendWageType}
                  onChange={(e) => setAmendWageType(e.target.value as "HOURLY" | "DAILY" | "MONTHLY")}
                  className="rounded-lg border border-border px-2 py-1.5 text-xs"
                >
                  {WAGE_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={amendAmount}
                  onChange={(e) => setAmendAmount(e.target.value)}
                  placeholder="金額"
                  className="w-20 rounded-lg border border-border px-2 py-1.5 text-xs"
                />
                <label className="flex flex-col gap-0.5 text-[11px] text-muted">
                  開始日
                  <input
                    type="date"
                    value={amendEffectiveFrom}
                    onChange={(e) => setAmendEffectiveFrom(e.target.value)}
                    className="rounded-lg border border-border px-2 py-1.5 text-xs"
                  />
                </label>
                <button
                  type="button"
                  disabled={pending || !amendAmount}
                  onClick={() => submitAmend(r)}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                >
                  保存
                </button>
                <button type="button" onClick={() => setAmendingId(null)} className="text-xs text-muted">
                  やめる
                </button>
              </div>
            ) : null}

            {endingId === r.id ? (
              <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-2">
                <label className="flex flex-col gap-0.5 text-[11px] text-muted">
                  終了日（この日から基本単価に戻す）
                  <input
                    type="date"
                    value={endEffectiveFrom}
                    onChange={(e) => setEndEffectiveFrom(e.target.value)}
                    className="rounded-lg border border-border px-2 py-1.5 text-xs"
                  />
                </label>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => submitEnd(r)}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                >
                  終了する
                </button>
                <button type="button" onClick={() => setEndingId(null)} className="text-xs text-muted">
                  やめる
                </button>
              </div>
            ) : null}
          </li>
        ))}
        {rates.length === 0 ? <p className="py-6 text-center text-sm text-muted">個別の単価は登録されていません。</p> : null}
      </ul>

      {showNewForm ? (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-3">
          <input
            type="text"
            value={newTaskName}
            onChange={(e) => setNewTaskName(e.target.value)}
            placeholder="業務内容（例：キャディ業務）"
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-end gap-2">
            <select
              value={newWageType}
              onChange={(e) => setNewWageType(e.target.value as "HOURLY" | "DAILY" | "MONTHLY")}
              className="rounded-lg border border-border px-2 py-2 text-sm"
            >
              {WAGE_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              placeholder="金額"
              className="w-24 rounded-lg border border-border px-2 py-2 text-sm"
            />
            <label className="flex flex-col gap-0.5 text-xs text-muted">
              開始日
              <input
                type="date"
                value={newEffectiveFrom}
                onChange={(e) => setNewEffectiveFrom(e.target.value)}
                className="rounded-lg border border-border px-2 py-2 text-sm"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={pending || !newTaskName.trim() || !newAmount}
            onClick={submitNewTask}
            className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            追加
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowNewForm(true)}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2.5 text-xs font-semibold text-muted hover:border-primary hover:text-primary"
        >
          ＋業務内容を追加
        </button>
      )}
    </div>
  );
}
