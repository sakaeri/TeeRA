"use client";

import { useState } from "react";
import Link from "next/link";
import { ShiftCard, type ShiftRow } from "@/components/staff/StaffTimecardView";

// 携帯は勤務中いじらない前提 — カレンダー画面の隅にカードを置くだけだと
// 見落とされるので、開くたびに自動でポップアップさせる。✕で閉じられる
// が「対応済み」フラグをどこかに保存して恒久的に消したりはしない —
// 未対応の間はページを開き直すたびにまた出る（打刻/報告の押し忘れに
// 気づいてもらうのが狙い）。対応済みになった（shiftsが空になった）
// 場合は自動で閉じる。
// 今日のシフトに加え、前日以前の未提出も（数件まで）出す。それ以上ある
// 場合はmoreUnsubmittedCountで業務報告のページへ案内する。
export function TodayShiftPopup({
  shifts,
  moreUnsubmittedCount = 0,
  taskNamesByWorkplace,
  workplacesByCompany = {},
}: {
  shifts: ShiftRow[];
  moreUnsubmittedCount?: number;
  // 勤務先ごとの業務内容（キーはworkplaceTaskKey）
  taskNamesByWorkplace: Record<string, string[]>;
  // 勤務先として選べる依頼主（会社ごと）
  workplacesByCompany?: Record<string, { companyRelationshipId: string; name: string }[]>;
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
      {/* 画面の上下に余白を残した高さまでにして、中身だけをスクロールさせる（見出しと✕は常に見える）。
          スマホのブラウザはvhだとツールバーの分はみ出すので、見えている高さ（dvh）で決める */}
      <div
        className="flex max-h-[calc(100dvh-7rem)] w-full max-w-sm flex-col rounded-2xl bg-white shadow-lg"
        data-testid="today-report-popup"
      >
        <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4 sm:px-6 sm:pt-6">
          <h2 className="font-serif-jp text-base font-bold text-primary">業務報告</h2>
          <button type="button" onClick={() => setOpen(false)} className="text-muted">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-6 sm:pb-6">
          <ul className="flex flex-col gap-3">
            {shifts.map((s) => (
              <ShiftCard key={s.id} shift={s} taskNamesByWorkplace={taskNamesByWorkplace} workplaces={workplacesByCompany[s.companyId] ?? []} />
            ))}
          </ul>
          {moreUnsubmittedCount > 0 ? (
            <Link href="/staff/timecard" className="mt-3 block text-center text-sm font-semibold text-primary underline">
              ほかに未提出が{moreUnsubmittedCount}件あります（業務報告へ）
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
