// 業務報告の承認を「月末にまとめて」にしている仮の依頼主の分かどうか、と、まだその月の途中か。
// 月の途中の分は、やることリスト・アイコンの数字・業務報告のまとめメールに出さない。
// 月が終わったら「〇〇の10月分の業務報告が◯件、未承認です」とまとめて出す。
export type ApprovalTimingRelationship = { reportApprovalTiming: string; clientCompanyId: string | null } | null | undefined;

export function isMonthlyApproval(rel: ApprovalTimingRelationship) {
  return Boolean(rel && rel.reportApprovalTiming === "MONTHLY" && !rel.clientCompanyId);
}

// shiftDate（DBの日付）が、今日（日本時間）と同じ月かそれより後なら、まだ月の途中
export function isMonthlyApprovalDeferred(rel: ApprovalTimingRelationship, shiftDate: Date, todayJst: string) {
  return isMonthlyApproval(rel) && shiftDate.toISOString().slice(0, 7) >= todayJst.slice(0, 7);
}
