import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TeeRA — シフト管理",
    short_name: "TeeRA",
    description: "TeeRA シフト管理プラットフォーム",
    start_url: "/",
    display: "standalone",
    background_color: "#faf7ef",
    theme_color: "#0b3d2e",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
