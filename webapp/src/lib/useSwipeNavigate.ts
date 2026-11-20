"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

// 横スワイプで前後に送る（カレンダーの日別のポップアップなど）。
// ・指に合わせて横に動き、離すと横に流れて次の中身が反対側から入る
// ・横にスワイプし始めたら縦スクロールは止める。縦に動かし始めた時は普通にスクロール
// ・data-no-swipe を付けた所（横にスクロールするタブなど）から始めたスワイプは無視する
export function useSwipeNavigate(onSwipe: (direction: 1 | -1) => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [slideX, setSlideX] = useState(0);
  const [animated, setAnimated] = useState(false);
  const onSwipeRef = useRef(onSwipe);
  useEffect(() => {
    onSwipeRef.current = onSwipe;
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const SWIPE_THRESHOLD_PX = 60;
    let startX: number | null = null;
    let startY: number | null = null;
    let axis: "x" | "y" | null = null;

    function go(direction: 1 | -1) {
      const width = el?.offsetWidth || window.innerWidth;
      setAnimated(true);
      setSlideX(-direction * width);
      window.setTimeout(() => {
        setAnimated(false);
        setSlideX(direction * width);
        onSwipeRef.current(direction);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            setAnimated(true);
            setSlideX(0);
          }),
        );
      }, 140);
    }
    function onStart(e: TouchEvent) {
      if ((e.target as HTMLElement | null)?.closest("[data-no-swipe]")) {
        startX = null;
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      axis = null;
      setAnimated(false);
    }
    function onMove(e: TouchEvent) {
      if (startX === null || startY === null) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis !== "x") return;
      e.preventDefault();
      setSlideX(dx);
    }
    function onEnd(e: TouchEvent) {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      const wasX = axis === "x";
      startX = null;
      startY = null;
      axis = null;
      if (!wasX || Math.abs(dx) < SWIPE_THRESHOLD_PX) {
        setAnimated(true);
        setSlideX(0);
        return;
      }
      go(dx < 0 ? 1 : -1);
    }
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const style: CSSProperties = {
    transform: slideX ? `translateX(${slideX}px)` : undefined,
    transition: animated ? "transform 140ms ease-out" : "none",
  };
  return { containerRef, style };
}
