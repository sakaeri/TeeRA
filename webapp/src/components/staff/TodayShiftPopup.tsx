"use client";

import { useState } from "react";
import { ShiftCard, type ShiftRow } from "@/components/staff/StaffTimecardView";

// 携帯は勤務中いじらない前提 — カレンダー画面の隅にカードを置くだけだと
// 見落とされるので、開くたびに自動でポップアップさせる。✕で閉じられる
// が「対応済み」フラグをどこかに保存して恒久的に消したりはしない —
// 未対応の間はページを開き直すたびにまた出る（打刻/報告の押し忘れに
// 気づいてもらうのが狙い）。対応済みになった（shiftsが空になった）
// 場合は自動で閉じる。
export function TodayShiftPopup({
  shifts,
  knownTaskNamesByCompany,
}: {
  shifts: ShiftRow[];
  knownTaskNamesByCompany: Record<string, string[]>;
}) {
  const [open, setOpen] = useState(shifts.length > 0);
  if (!open || shifts.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-4 shadow-lg sm:p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif-jp text-base font-bold text-primary">本日の出退勤</h2>
          <button type="button" onClick={() => setOpen(false)} className="text-muted">
            ✕
          </button>
        </div>
        <ul className="flex flex-col gap-3">
          {shifts.map((s) => (
            <ShiftCard key={s.id} shift={s} knownTaskNames={knownTaskNamesByCompany[s.companyId] ?? []} />
          ))}
        </ul>
      </div>
    </div>
  );
}
