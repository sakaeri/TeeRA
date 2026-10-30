import type { Metadata, Viewport } from "next";
import { Zen_Old_Mincho } from "next/font/google";
import "./globals.css";
import { ServiceWorkerSetup } from "@/components/ServiceWorkerSetup";

// 本文の書体は、スマホ・パソコンにもともと入っている日本語の書体を使う
// （globals.cssの--font-sans-jp）。以前はNoto Sans JPをネットから読み込んで
// いたが、日本語の書体は数十ファイル・約600KBあり、電波が弱いと書体の到着を
// 待つ間に文字が表示されない（ページが枠だけになる）ことがあったため。
// Androidの標準の書体はNoto Sans（CJK）なので、見た目はほぼ変わらない。
//
// 見出しの明朝体だけはネットから読み込むが、すぐに届かなければ待たずに
// 端末の明朝体で表示する（display: optional。2回目以降は保存された書体が使われる）。
const zenOldMincho = Zen_Old_Mincho({
  variable: "--font-zen-old-mincho",
  subsets: ["latin"],
  weight: ["700"],
  display: "optional",
  preload: false,
  fallback: ["Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", "Noto Serif JP", "serif"],
});

// iPhoneの画面サイズ（CSSピクセル幅・高さ・倍率）。public/splash/の画像と対応
const SPLASH_SIZES: [number, number, number][] = [
  [440, 956, 3],
  [430, 932, 3],
  [402, 874, 3],
  [393, 852, 3],
  [428, 926, 3],
  [390, 844, 3],
  [375, 812, 3],
  [414, 896, 3],
  [414, 896, 2],
  [414, 736, 3],
  [375, 667, 2],
  [320, 568, 2],
];

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
    // ホーム画面のアイコンから開いた直後の画面（iPhoneは機種ごとの画面サイズの画像が必要）
    startupImage: SPLASH_SIZES.map(([w, h, dpr]) => ({
      url: `/splash/apple-splash-${w * dpr}x${h * dpr}.png`,
      media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`,
    })),
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
      className={`${zenOldMincho.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerSetup />
      </body>
    </html>
  );
}
