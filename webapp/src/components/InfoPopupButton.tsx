"use client";

import { useState } from "react";

// 「i」マーク。押すと説明を画面の真ん中にポップアップで出す（吹き出しだと、スマホで画面の外に
// はみ出すことがあったため）。説明の文は children で渡す。
export function InfoPopupButton({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label="説明を見る"
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted/20 text-[10px] font-bold text-muted ${className}`}
      >
        i
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-label={title ?? "説明"}
            className="w-full max-w-sm rounded-2xl bg-white p-5 text-left shadow-lg"
            onClick={(e) => e.stopPropagation()}
            data-testid="info-popup"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <h3 className="font-serif-jp text-base font-bold text-primary">{title ?? "説明"}</h3>
              <button type="button" onClick={() => setOpen(false)} className="text-muted" aria-label="閉じる">
                ✕
              </button>
            </div>
            <div className="text-sm font-normal normal-case leading-relaxed text-foreground">{children}</div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              閉じる
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
