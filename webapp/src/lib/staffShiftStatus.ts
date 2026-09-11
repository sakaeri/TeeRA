// タイムカード関連のシフト行の「対応済みかどうか」判定 — Server
// Component（スタッフ側カレンダーページの「本日の出退勤」カード用の絞り
// 込み）とClient Component（StaffTimecardView）の両方から使うため、
// "use client"の付いたモジュールとは別に置く（クライアント専用モジュール
// のプレーン関数はサーバー側から直接呼び出せない）。
export type ShiftRow = {
  id: string;
  workReportId: string | null;
  date: string;
  companyId: string;
  companyName: string;
  workplaceName: string | null;
  startTime: string | null;
  endTime: string | null;
  taskName: string | null;
  clockIn: string | null;
  clockOut: string | null;
  clockInTime: string | null;
  clockOutTime: string | null;
  breakMinutes: number;
  outcome: string | null;
  approvalStatus: string | null;
  computedMinutes: number;
  submittedAt: string | null;
};

// 「済み」＝欠勤/キャンセルとして報告済み、または業務報告を提出して
// 承認待ち・承認済みになったもの（差し戻しREJECTEDだけは修正して
// 再提出が必要なので「対応が必要」側に残す）。
// 出勤/退勤の打刻だけではWorkReport行のoutcome/approvalStatusに既定値
// （WORKED/PENDING）が入るため、それらだけでは「打刻しただけ」と
// 「実際に提出した」を区別できない。submittedAt（提出時に確実にセット
// される）で見分ける。
export function isDone(shift: ShiftRow) {
  const finalized = shift.outcome !== null && shift.outcome !== "WORKED";
  const submitted =
    shift.outcome === "WORKED" &&
    Boolean(shift.submittedAt) &&
    (shift.approvalStatus === "PENDING" || shift.approvalStatus === "APPROVED");
  return finalized || submitted;
}
