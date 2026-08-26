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
