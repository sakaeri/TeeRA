"use client";

import { useEffect, useRef } from "react";

// ドロップダウン/メニューの外側をクリックした時に閉じるための共通フック。
export function useClickOutside<T extends HTMLElement>(active: boolean, onOutside: () => void) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    function handlePointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOutside();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [active, onOutside]);

  return ref;
}
