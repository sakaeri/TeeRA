// 会社側の画面（カレンダー・スタッフ名簿・依頼主パネル）で、シフトの業務報告
// をどう見せるかの共通判定。出勤を打刻した時点でWorkReport行が既定値PENDING
// で作られるため、approvalStatusだけを見ると「打刻しただけ（未提出）」が
// 「未承認」に見えてしまう。提出済みかどうかはsubmittedAtで判定する。

type ReportLike = {
  approvalStatus: string;
  outcome: string;
  submittedAt: Date | null;
  clockIn: Date | null;
  clockOut: Date | null;
  taskName?: string | null;
};

export const OUTCOME_LABEL: Record<string, string> = {
  ABSENT: "欠勤",
  CANCELLED_BY_EMPLOYER: "勤務先キャンセル",
};

function formatJstTime(date: Date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

export function isReportSubmitted(report: ReportLike | null | undefined): report is ReportLike {
  return Boolean(report && (report.submittedAt || report.approvalStatus !== "PENDING"));
}

// 提出済みの報告の内容。未提出ならapprovalStatus/outcomeはnull（＝未提出）。
// reportedTimeLabelは出勤報告の実績時間（欠勤・キャンセルの時は打刻が
// 残っていても出さない — 勤務したように見えてしまうため）。
export function reportDisplay(report: ReportLike | null | undefined) {
  if (!isReportSubmitted(report)) {
    return { approvalStatus: null, outcome: null, reportedTimeLabel: null, reportedTaskName: null };
  }
  const worked = report.outcome === "WORKED";
  return {
    approvalStatus: report.approvalStatus,
    outcome: report.outcome,
    reportedTimeLabel:
      worked && report.clockIn && report.clockOut ? `${formatJstTime(report.clockIn)}〜${formatJstTime(report.clockOut)}` : null,
    reportedTaskName: worked ? (report.taskName ?? null) : null,
  };
}
