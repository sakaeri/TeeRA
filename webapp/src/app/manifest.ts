import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TeeRA — シフト管理",
    short_name: "TeeRA",
    description: "TeeRA シフト管理プラットフォーム",
    start_url: "/",
    display: "standalone",
    // ホーム画面アプリの「窓」の地の色。iPhone（iOS 26）は、時計・電池の帯の文字色や
    // 上のぼかしの色、上に引っぱった時に見える色をこの色から決めるため、クリーム色だと
    // ヘッダーの上に白っぽいモヤがかかり、時計の文字も黒になる。ヘッダーと同じ緑にする。
    background_color: "#0b3d2e",
    theme_color: "#0b3d2e",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
