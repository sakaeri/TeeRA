// このアプリの日付はすべて日本のスタッフ/現場を前提としたJSTの暦日として扱う。
// `new Date().toISOString().slice(0, 10)` はサーバー/ブラウザの実行タイムゾーン
// に関わらず常にUTCの暦日を返すため、JST 0〜8時台（UTC前日15〜23時台）は
// 「今日」が前日の日付になってしまう。Date.now()にJSTのオフセットを足してから
// ISO文字列化することで、実行環境のタイムゾーンに依存せず正しいJSTの暦日を得る。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function todayJst(): string {
  return new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

// 「今月」のデフォルト表示(y/mクエリなし)や月次集計の対象月決定など、
// 現在時刻から年/月を取り出す箇所で使う。
export function todayJstParts(): { year: number; month: number; day: number } {
  const [year, month, day] = todayJst().split("-").map(Number);
  return { year, month, day };
}

// isReportOverdue等、日付の比較に加えて「今何時か」も必要な箇所向け。
// getHours/getMinutesは実行環境のローカルタイムゾーンに依存するため、
// クライアント側(ブラウザがJSTのユーザー)でのみ安全に使うこと。
export function nowJstHHMM(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export type MonthCutoff = { year: number; month: number } | null;

// 無料プランの過去データ閲覧制限（直近3ヶ月＝当月＋過去2ヶ月）の下限月。
// 有料プランはnull（制限なし）。ダウングレード時のグランドファザリングは
// 行わない方針のため、呼び出しの都度その場で計算する（保存されたカット
// オフ値は持たない）。
export function earliestAllowedMonth(planTier: "FREE" | "STANDARD" | "BUSINESS"): MonthCutoff {
  if (planTier !== "FREE") return null;
  const { year, month } = todayJstParts();
  let y = year;
  let m = month - 2;
  if (m <= 0) {
    m += 12;
    y -= 1;
  }
  return { year: y, month: m };
}

export function isBeforeCutoff(year: number, month: number, cutoff: MonthCutoff): boolean {
  if (!cutoff) return false;
  if (year !== cutoff.year) return year < cutoff.year;
  return month < cutoff.month;
}

// targetMonth/periodLabelのような"YYYY-MM"のゼロ埋め文字列比較で使うための変換。
export function cutoffMonthString(cutoff: MonthCutoff): string | null {
  if (!cutoff) return null;
  return `${cutoff.year}-${String(cutoff.month).padStart(2, "0")}`;
}

// 当月（JST暦月）の開始・終了をUTC基準のDateとして返す — issuedAtのような
// UTCタイムスタンプ列をJST暦月で絞り込みたい場合（PDF発行の無料枠集計等）
// に使う。endは翌月開始（排他的な上限）。
export function currentJstMonthRangeUtc(): { start: Date; end: Date } {
  const { year, month } = todayJstParts();
  const start = new Date(Date.UTC(year, month - 1, 1) - JST_OFFSET_MS);
  const end = new Date(Date.UTC(year, month, 1) - JST_OFFSET_MS);
  return { start, end };
}
