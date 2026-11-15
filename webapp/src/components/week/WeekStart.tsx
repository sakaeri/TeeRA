"use client";

import { createContext, useContext } from "react";

// カレンダーの週の始まり（日曜始まり／月曜始まり）。人ごとにアカウント設定で選べる。
// 会社側・スタッフ側のレイアウトで、その人の設定を Provider に入れて全カレンダーに効かせる。
const WeekStartContext = createContext(false);

export function WeekStartProvider({ mondayFirst, children }: { mondayFirst: boolean; children: React.ReactNode }) {
  return <WeekStartContext.Provider value={mondayFirst}>{children}</WeekStartContext.Provider>;
}

export function useMondayFirst() {
  return useContext(WeekStartContext);
}

const LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// 見出しに並べる曜日（dow は 0=日〜6=土。色分けに使う）
export function orderedWeekdays(mondayFirst: boolean) {
  const order = mondayFirst ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  return order.map((dow) => ({ dow, label: LABELS[dow] }));
}

// 月の1日の前に入れる空きマスの数
export function leadingBlankCount(year: number, month: number, mondayFirst: boolean) {
  const dow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return mondayFirst ? (dow + 6) % 7 : dow;
}
