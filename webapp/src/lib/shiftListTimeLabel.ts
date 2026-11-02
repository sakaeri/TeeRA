// シフト表（PDF・共有画像）の「時間」欄。報告が出ていれば報告の内容（出勤は実際の時間、
// 欠勤・取消はその旨）を、日付が過ぎたのに報告がまだのものは「未報告」と分かるようにする。
// 今日以降で報告がまだのものは、予定の時間のまま。
export function shiftListTimeLabel(s: {
  date: string; // YYYY-MM-DD
  todayStr: string;
  isUndecided: boolean;
  isAllDay: boolean;
  startTime: string | null;
  endTime: string | null;
  outcome?: string | null;
  reportedTimeLabel?: string | null;
}) {
  const planned = s.isUndecided ? "未定" : s.isAllDay ? "終日" : `${s.startTime ?? "--:--"}〜${s.endTime ?? "--:--"}`;
  if (s.outcome === "WORKED") return s.reportedTimeLabel ?? planned;
  if (s.outcome === "ABSENT") return "欠勤";
  if (s.outcome === "CANCELLED_BY_EMPLOYER") return "取消";
  if (s.date < s.todayStr) return s.isUndecided || s.isAllDay ? "未報告" : `${planned}（未報告）`;
  return planned;
}
