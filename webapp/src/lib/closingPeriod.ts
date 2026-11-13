// 締め日（1〜28日。null・範囲外は末日締め）から、「◯月分」の対象期間を決める。
// 例：20日締めの「2026-11」分 → 2026/10/21〜2026/11/20（end は次の日の0時＝含まない）。
// 末日締めは今まで通りその月の1日〜末日。29〜31日は月によって無い日があるため選べない（末日を使う）。
export function normalizeClosingDay(value: number | null | undefined): number | null {
  if (value == null || !Number.isInteger(value) || value < 1 || value > 28) return null;
  return value;
}

export function closingPeriod(month: string, closingDay: number | null | undefined) {
  const [year, m] = month.split("-").map(Number);
  const day = normalizeClosingDay(closingDay);
  if (day === null) {
    return { start: new Date(Date.UTC(year, m - 1, 1)), end: new Date(Date.UTC(year, m, 1)), closingDay: null, rangeLabel: null };
  }
  const start = new Date(Date.UTC(year, m - 2, day + 1));
  const end = new Date(Date.UTC(year, m - 1, day + 1));
  const last = new Date(end.getTime() - 24 * 3600e3);
  const rangeLabel = `${start.getUTCMonth() + 1}/${start.getUTCDate()}〜${last.getUTCMonth() + 1}/${last.getUTCDate()}`;
  return { start, end, closingDay: day, rangeLabel };
}

export function closingDayLabel(closingDay: number | null | undefined) {
  const day = normalizeClosingDay(closingDay);
  return day === null ? "末日締め" : `${day}日締め`;
}

// 設定画面の選択肢（末日・1〜28日）
export const CLOSING_DAY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "末日締め" },
  ...Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}日締め` })),
];
