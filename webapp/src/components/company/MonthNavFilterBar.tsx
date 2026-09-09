"use client";

import { useRouter } from "next/navigation";

// カレンダー/スタッフ詳細パネルの月送り「＜ ＞」と見た目・挙動を揃える
// ための共通部品。「開く」ボタン式の月＋対象選択フォームだと、無料プラン
// のカットオフに近づいても事前のサインが弱く、ある日突然見れなくなった
// ように感じられるため、矢印＋カットオフで無効化する形に統一した。
function addMonths(monthStr: string, delta: number) {
  const [year, month] = monthStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function MonthNavFilterBar({
  targetMonth,
  minMonth,
  todayMonth,
  extraParamName,
  extraParamValue,
  extraLabel,
  extraOptions,
  basePath,
}: {
  targetMonth: string;
  minMonth: string | null;
  todayMonth: string;
  extraParamName: string;
  extraParamValue: string | undefined;
  extraLabel: string;
  extraOptions: { id: string; name: string }[];
  basePath: string;
}) {
  const router = useRouter();
  const [year, month] = targetMonth.split("-").map(Number);
  const prevMonth = addMonths(targetMonth, -1);
  const nextMonth = addMonths(targetMonth, 1);
  const atCutoff = minMonth !== null && targetMonth === minMonth;

  function navigate(month: string, extraValue: string | undefined) {
    const params = new URLSearchParams({ month });
    if (extraValue) params.set(extraParamName, extraValue);
    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-border bg-white/60 p-4">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => navigate(prevMonth, extraParamValue)}
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
          onClick={() => navigate(todayMonth, extraParamValue)}
          aria-label="当月に戻る"
          className="rounded-lg px-2 py-1 font-serif-jp text-base font-bold whitespace-nowrap hover:bg-background"
        >
          {year}年{month}月
        </button>
        <button
          type="button"
          onClick={() => navigate(nextMonth, extraParamValue)}
          aria-label="次の月"
          className="rounded-full p-1.5 text-muted hover:bg-background hover:text-primary"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        {extraLabel}
        <select
          value={extraParamValue ?? ""}
          onChange={(e) => navigate(targetMonth, e.target.value || undefined)}
          className="rounded-lg border border-border px-2 py-2 text-sm"
        >
          <option value="">選択してください</option>
          {extraOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
