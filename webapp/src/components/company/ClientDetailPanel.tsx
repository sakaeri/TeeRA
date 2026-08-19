"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getClientMonthDetailAction, updateClientNoteAction } from "@/app/company/actions";

type ClientMonthDetail = {
  relationshipId: string;
  name: string;
  note: string;
  shiftCount: number;
  unapprovedCount: number;
  staff: { userId: string; name: string }[];
  placementRates: { id: string; taskName: string; amountLabel: string }[];
  days: {
    shiftId: string;
    date: string;
    staffName: string;
    startTime: string | null;
    endTime: string | null;
    isAllDay: boolean;
    isUndecided: boolean;
    approvalStatus: string | null;
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

function timeLabel(d: ClientMonthDetail["days"][number]) {
  if (!d.approvalStatus) return "未提出";
  if (d.isUndecided) return "未定";
  if (d.isAllDay) return "終日";
  return `${d.startTime ?? "--:--"}〜${d.endTime ?? "--:--"}`;
}

export function ClientDetailPanel({ relationshipId, onClose }: { relationshipId: string; onClose: () => void }) {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [tab, setTab] = useState<"history" | "staff" | "rates" | "note">("history");
  const [data, setData] = useState<ClientMonthDetail | null>(null);
  const [noteValue, setNoteValue] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getClientMonthDetailAction(relationshipId, year, month).then((d) => {
      if (cancelled) return;
      setData(d);
      setNoteValue(d.note);
    });
    return () => {
      cancelled = true;
    };
  }, [relationshipId, year, month]);

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
            <h2 className="mb-4 font-serif-jp text-xl font-bold">{data.name}</h2>

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
                onClick={() => setTab("staff")}
                className={`border-b-2 px-1 py-2 font-semibold ${tab === "staff" ? "border-accent text-primary" : "border-transparent text-muted"}`}
              >
                スタッフ一覧
              </button>
              <button
                type="button"
                onClick={() => setTab("rates")}
                className={`border-b-2 px-1 py-2 font-semibold ${tab === "rates" ? "border-accent text-primary" : "border-transparent text-muted"}`}
              >
                契約・単価
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
                    <p className="text-xs text-muted">稼働数</p>
                    <p className="text-lg font-bold">{data.shiftCount}件</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted">未承認数</p>
                    <p className="text-lg font-bold text-rose-600">{data.unapprovedCount}件</p>
                  </div>
                  <div className="flex flex-col items-center justify-center rounded-lg border border-border p-3">
                    <p className="mb-1 text-xs text-muted">請求明細</p>
                    <button
                      type="button"
                      onClick={() =>
                        router.push(`/company/invoices?month=${year}-${String(month).padStart(2, "0")}&client=${relationshipId}`)
                      }
                      className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
                    >
                      作成する
                    </button>
                  </div>
                </div>

                <ul className="flex flex-col gap-1">
                  {data.days.map((d) => (
                    <li key={d.shiftId} className="flex items-center justify-between border-b border-border/50 py-2 text-sm">
                      <span>{d.date}</span>
                      <span>{d.staffName}</span>
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

            {tab === "staff" ? (
              <ul className="flex flex-col gap-2">
                {data.staff.map((s) => (
                  <li key={s.userId} className="rounded-lg border border-border p-3 text-sm">
                    {s.name}
                  </li>
                ))}
                {data.staff.length === 0 ? <p className="py-6 text-center text-sm text-muted">稼働実績のあるスタッフはいません。</p> : null}
              </ul>
            ) : null}

            {tab === "rates" ? (
              <ul className="flex flex-col gap-2">
                {data.placementRates.map((r) => (
                  <li key={r.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                    <span>{r.taskName}</span>
                    <span className="text-muted">{r.amountLabel}</span>
                  </li>
                ))}
                {data.placementRates.length === 0 ? <p className="py-6 text-center text-sm text-muted">単価が未設定です。</p> : null}
              </ul>
            ) : null}

            {tab === "note" ? (
              <div className="flex flex-col gap-3">
                <textarea
                  value={noteValue}
                  onChange={(e) => setNoteValue(e.target.value)}
                  rows={8}
                  placeholder="この取引先に関するメモを入力"
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => updateClientNoteAction(data.relationshipId, noteValue))}
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
