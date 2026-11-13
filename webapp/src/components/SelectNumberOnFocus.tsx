"use client";

import { useEffect } from "react";

// 数字の入力欄をタップ（フォーカス）した時に、中の数字を全部選んだ状態にする。
// 最初から「0」が入っている欄に打つと「01」になり、0をわざわざ消す必要があったため。
// 選んだ状態なら、打った数字でそのまま置き換わる。アプリ全体の数字の欄にまとめて効かせる。
export function SelectNumberOnFocus() {
  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || el.type !== "number" || el.readOnly || el.disabled) return;
      // iPhoneはフォーカス直後に選ぶと外れることがあるため、少し待ってから選ぶ
      setTimeout(() => {
        if (document.activeElement === el) el.select();
      }, 0);
    }
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);
  return null;
}
