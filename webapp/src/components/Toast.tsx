"use client";

import { useEffect, useState } from "react";

// 画面の下に数秒だけ出すお知らせ。カードが一覧から消える操作（業務報告の提出など）
// でも「完了した」ことが分かるよう、カードの外（シェル）に置いて表示する。
const EVENT = "teera:toast";

export function showToast(message: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

export function Toaster() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onToast = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 3500);
    };
    window.addEventListener(EVENT, onToast);
    return () => {
      window.removeEventListener(EVENT, onToast);
      clearTimeout(timer);
    };
  }, []);
  if (!message) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-sm rounded-xl bg-primary px-4 py-3 text-center text-sm font-semibold text-primary-foreground shadow-lg"
    >
      {message}
    </div>
  );
}
