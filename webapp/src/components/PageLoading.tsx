// 画面を切り替えた時、データを読み込んでいる間に出す枠（ヘッダーとメニューはそのまま）。
// これが無いと、タップしても読み込みが終わるまで前の画面のまま止まって見える。
export function PageLoading() {
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6" aria-busy="true" aria-label="読み込み中">
      <div className="h-7 w-40 animate-pulse rounded-lg bg-border/60" />
      <div className="h-24 animate-pulse rounded-2xl bg-border/40" />
      <div className="h-24 animate-pulse rounded-2xl bg-border/40" />
      <div className="h-24 animate-pulse rounded-2xl bg-border/40" />
      <p className="text-center text-xs text-muted">読み込み中…</p>
    </div>
  );
}
