import { normalizeClosingDay } from "@/lib/closingPeriod";

// 業務報告の承認を「月末（締め日）にまとめて」にしている仮の依頼主の分かどうか、と、まだその期間の途中か。
// 期間の途中の分は、やることリスト・アイコンの数字・業務報告のまとめメールに出さない。
// 期間が終わったら「〇〇の10月分の業務報告が◯件、未承認です」とまとめて出す。
// 期間は依頼主の請求書の締め日（invoiceClosingDay）に合わせる（末日締めなら暦の月）。
export type ApprovalTimingRelationship =
  | { reportApprovalTiming: string; clientCompanyId: string | null; invoiceClosingDay?: number | null }
  | null
  | undefined;

export function isMonthlyApproval(rel: ApprovalTimingRelationship) {
  return Boolean(rel && rel.reportApprovalTiming === "MONTHLY" && !rel.clientCompanyId);
}

// その日付が「何月分」に入るか（YYYY-MM）。20日締めなら11/21は「12月分」
export function approvalPeriodMonth(rel: ApprovalTimingRelationship, dateStr: string) {
  const closingDay = normalizeClosingDay(rel?.invoiceClosingDay);
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  if (closingDay === null || d <= closingDay) return dateStr.slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

// shiftDate（DBの日付）が、今日（日本時間）と同じ期間かそれより後なら、まだ期間の途中
export function isMonthlyApprovalDeferred(rel: ApprovalTimingRelationship, shiftDate: Date, todayJst: string) {
  return (
    isMonthlyApproval(rel) &&
    approvalPeriodMonth(rel, shiftDate.toISOString().slice(0, 10)) >= approvalPeriodMonth(rel, todayJst)
  );
}
