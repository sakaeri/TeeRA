"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";

type YearMonth = { y: number; m: number };

function shiftMonth({ y, m }: YearMonth, delta: 1 | -1): YearMonth {
  const index = y * 12 + (m - 1) + delta;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
}

// 月のカレンダーの月送り（本部・スタッフのカレンダーで共通）。
// ・押した／スワイプした瞬間に次の月の枠を出し、シフトなどのデータは届きしだい埋まる
// ・スワイプ中はカレンダーが指に合わせて横に動き、離すと横に流れて次の月が入る
// ・横にスワイプし始めたら、画面が上下に動かないようにする（縦スクロールは止める）
export function useMonthSwipe({
  year: dataYear,
  month: dataMonth,
  hrefFor,
  prevBlockedAt = null,
}: {
  year: number;
  month: number;
  // 指定の月を表示するURL（?y=..&m=.. に絞り込みなどを付けたもの）
  hrefFor: (y: number, m: number) => string;
  // この月を表示しているときは前の月へ戻れない（無料プランの閲覧範囲の端）
  prevBlockedAt?: { year: number; month: number } | null;
}) {
  const router = useRouter();
  const [pendingMonth, setPendingMonth] = useState<YearMonth | null>(null);
  const [, startTransition] = useTransition();
  const showingPending = Boolean(pendingMonth && !(pendingMonth.y === dataYear && pendingMonth.m === dataMonth));
  const year = showingPending ? pendingMonth!.y : dataYear;
  const month = showingPending ? pendingMonth!.m : dataMonth;
  const prev = shiftMonth({ y: year, m: month }, -1);
  const next = shiftMonth({ y: year, m: month }, 1);
  const canGoPrev = !(prevBlockedAt && prevBlockedAt.year === year && prevBlockedAt.month === month);

  const [slideX, setSlideX] = useState(0);
  const [animated, setAnimated] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // 切り替えの間に画面の高さが一瞬変わっても、スクロール位置が上下に飛ばないように覚えておく
  // （次の月のデータが届くまでは枠が空で低くなるので、その間は高さを保っておく）
  const keepScrollY = useRef<number | null>(null);
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);
  useEffect(() => {
    if (keepScrollY.current === null) return;
    const y = keepScrollY.current;
    keepScrollY.current = null;
    requestAnimationFrame(() => {
      setLockedHeight(null);
      window.scrollTo(0, y);
    });
  }, [dataYear, dataMonth]);

  function goToMonth(direction: 1 | -1) {
    if (direction === -1 && !canGoPrev) return;
    const target = direction === 1 ? next : prev;
    const width = containerRef.current?.offsetWidth || window.innerWidth;
    // 今の月を流し出し、反対側から次の月の枠を入れる
    setAnimated(true);
    setSlideX(-direction * width);
    keepScrollY.current = window.scrollY;
    setLockedHeight(containerRef.current?.offsetHeight ?? null);
    window.setTimeout(() => {
      setAnimated(false);
      setSlideX(direction * width);
      setPendingMonth(target);
      startTransition(() => router.push(hrefFor(target.y, target.m), { scroll: false }));
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (keepScrollY.current !== null) window.scrollTo(0, keepScrollY.current);
          setAnimated(true);
          setSlideX(0);
        }),
      );
    }, 160);
  }

  // タッチの処理はネイティブのイベントで付ける（横スワイプ中に縦スクロールを
  // 止めるには、passive: false で preventDefault する必要があるため）
  const goRef = useRef(goToMonth);
  const canGoPrevRef = useRef(canGoPrev);
  useEffect(() => {
    goRef.current = goToMonth;
    canGoPrevRef.current = canGoPrev;
  });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const SWIPE_THRESHOLD_PX = 60;
    let startX: number | null = null;
    let startY: number | null = null;
    let axis: "x" | "y" | null = null;

    function onStart(e: TouchEvent) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      axis = null;
      setAnimated(false);
    }
    function onMove(e: TouchEvent) {
      if (startX === null || startY === null) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      // 動き始めの向きで、横スワイプか縦スクロールかを決める
      if (!axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis !== "x") return;
      e.preventDefault();
      // 前の月に戻れない月（無料プランの閲覧範囲の端）では、少しだけ動いて戻る
      setSlideX(dx > 0 && !canGoPrevRef.current ? dx / 4 : dx);
    }
    function onEnd(e: TouchEvent) {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      const wasX = axis === "x";
      startX = null;
      startY = null;
      axis = null;
      if (!wasX || Math.abs(dx) < SWIPE_THRESHOLD_PX || (dx > 0 && !canGoPrevRef.current)) {
        setAnimated(true);
        setSlideX(0);
        return;
      }
      goRef.current(dx < 0 ? 1 : -1);
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
    transition: animated ? "transform 160ms ease-out" : "none",
    opacity: showingPending ? 0.85 : 1,
    minHeight: lockedHeight ?? undefined,
  };

  return { year, month, prev, next, canGoPrev, showingPending, goToMonth, containerRef, style };
}
