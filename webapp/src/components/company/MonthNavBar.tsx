"use client";

import { useRouter } from "next/navigation";

// カレンダー/スタッフ詳細パネルの月送り「＜ ＞」と見た目・挙動を揃える
// ための共通部品。「開く」ボタン式の月選択フォームだと、無料プランの
// カットオフに近づいても事前のサインが弱く、ある日突然見れなくなった
// ように感じられるため、矢印＋カットオフで無効化する形に統一した。
function addMonths(monthStr: string, delta: number) {
  const [year, month] = monthStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function MonthNavBar({
  targetMonth,
  minMonth,
  todayMonth,
  basePath,
}: {
  targetMonth: string;
  minMonth: string | null;
  todayMonth: string;
  basePath: string;
}) {
  const router = useRouter();
  const [year, month] = targetMonth.split("-").map(Number);
  const prevMonth = addMonths(targetMonth, -1);
  const nextMonth = addMonths(targetMonth, 1);
  const atCutoff = minMonth !== null && targetMonth === minMonth;

  function navigate(month: string) {
    router.push(`${basePath}?${new URLSearchParams({ month }).toString()}`);
  }

  return (
    <div className="mb-6 flex items-center justify-center gap-1">
      <button
        type="button"
        onClick={() => navigate(prevMonth)}
        disabled={atCutoff}
        aria-label="前の月"
        className="rounded-full p-1.5 text-muted hover:bg-background hover:text-primary disabled:cursor-not-allowed disabled:text-border disabled:hover:bg-transparent"
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
          <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => navigate(todayMonth)}
        aria-label="当月に戻る"
        className="rounded-lg px-2 py-1 font-serif-jp text-base font-bold whitespace-nowrap hover:bg-background"
      >
        {year}年{month}月
      </button>
      <button
        type="button"
        onClick={() => navigate(nextMonth)}
        aria-label="次の月"
        className="rounded-full p-1.5 text-muted hover:bg-background hover:text-primary"
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
          <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
