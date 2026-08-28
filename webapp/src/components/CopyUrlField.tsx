"use client";

import { useState } from "react";

// 招待URL等の「入力欄＋コピー」を各所で使い回す。コピー後は数秒だけ
// チェックマークに切り替えて、押した操作が反映されたことを分かるようにする
// （押しても見た目が変わらず「効いてるか分からない」という指摘への対応）。
export function CopyUrlField({ url, size = "md" }: { url: string; size?: "sm" | "md" }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  const inputClass =
    size === "sm"
      ? "flex-1 rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-muted"
      : "flex-1 rounded-lg border border-border px-3 py-2 text-sm text-muted";
  const buttonClass =
    size === "sm"
      ? "flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
      : "flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground";
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <div className="flex items-center gap-2">
      <input type="text" readOnly value={url} className={inputClass} />
      <button type="button" onClick={handleCopy} className={buttonClass}>
        {copied ? (
          <>
            <svg viewBox="0 0 20 20" fill="none" className={iconSize}>
              <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6.5 10.3L8.8 12.6L13.5 7.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            コピーしました
          </>
        ) : (
          "コピー"
        )}
      </button>
    </div>
  );
}
