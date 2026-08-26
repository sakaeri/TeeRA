"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getStaffMonthDetailAction, updateStaffNoteAction, inviteProxyUpgradeAction } from "@/app/company/actions";
import { todayJstParts } from "@/lib/date";

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
  const [tab, setTab] = useState<"history" | "contracts" | "note">("history");
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
