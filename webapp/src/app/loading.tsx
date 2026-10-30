// アプリを開いた直後、画面のデータがそろうまでの間に出す読み込み画面。
// 真っ白のまま待たせないよう、ロゴの木だけを先に表示する。
// （メニューの切り替えでは出ない — 各画面の外側のレイアウトが残るため）
// iPhoneの起動画面（public/splash/apple-splash-*.png）と同じ大きさ・位置にして、
// 切り替わっても木が動かないようにしている。
export default function Loading() {
  return (
    <div className="flex min-h-dvh flex-1 items-center justify-center bg-background" role="status">
      {/* eslint-disable-next-line @next/next/no-img-element -- 読み込み画面は軽さ優先で画像最適化を通さない */}
      <img src="/splash/tree.webp" alt="" width={120} height={131} className="animate-pulse" />
      <span className="sr-only">読み込み中</span>
    </div>
  );
}
