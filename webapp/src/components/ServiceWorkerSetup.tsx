"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// 電波が弱いときの表示（public/sw.js）を有効にする。
// ・全員の端末にsw.jsを登録する（以前はプッシュ通知を許可した人だけだった）
// ・ネットから届かず前回の内容を表示しているときは、そのことを上に出す
// ・ログイン画面（ログアウト後など）では、端末に保存したページの内容を消す
//   （前のアカウントの画面が電波の弱いときに出ないようにする）
const LOGGED_OUT_PATHS = ["/login", "/register"];

export function ServiceWorkerSetup() {
  const pathname = usePathname();
  const [servedFromCopy, setServedFromCopy] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    const controller = navigator.serviceWorker.controller;
    if (!controller) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => {
      if (e.data?.servedFromCopy) setServedFromCopy(true);
    };
    controller.postMessage({ type: "served-from-copy?" }, [channel.port2]);
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (!LOGGED_OUT_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return;
    navigator.serviceWorker.controller?.postMessage({ type: "clear-pages" });
  }, [pathname]);

  if (!servedFromCopy) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-between gap-3 bg-foreground px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-xs text-white">
      <span>電波が弱いため、前回開いたときの内容を表示しています。</span>
      <button
        type="button"
        onClick={() => location.reload()}
        className="shrink-0 rounded-lg bg-white px-3 py-1.5 font-semibold text-foreground"
      >
        読み込み直す
      </button>
    </div>
  );
}
