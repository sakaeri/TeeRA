import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP, Zen_Old_Mincho } from "next/font/google";
import "./globals.css";

const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const zenOldMincho = Zen_Old_Mincho({
  variable: "--font-zen-old-mincho",
  subsets: ["latin"],
  weight: ["700"],
});

export const metadata: Metadata = {
  title: "TeeRA — シフト管理",
  description: "TeeRA シフト管理プラットフォーム",
  // iOSでホーム画面に追加して開いた場合（スタンドアロン表示）は、
  // ステータスバーの色はtheme-color/bodyの背景色では一切制御できず、
  // この apple-mobile-web-app-status-bar-style だけが効く。
  // black-translucentでステータスバーを透過させ、下のページ内容
  // （ヘッダーのセーフエリア分パディング済みの緑）を透かして見せる。
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TeeRA",
  },
};

// viewportFit: "cover" でノッチ/ステータスバー領域までページ描画を広げ、
// themeColorでヘッダーと同じ色(--brand-primary)をブラウザに伝える —
// これが無いと、モバイルでヘッダー上部の帯より上（セーフエリア）が
// bodyのクリーム色(--background)のまま見えてしまう。
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b3d2e",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      className={`${notoSansJP.variable} ${zenOldMincho.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
