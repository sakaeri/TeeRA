// 請求書PDFの明細を「業務×単価×税率」ごとに1行にまとめる。
// シフト由来の行（shiftIdあり）だけをまとめ、手で追加した行（交通費など）は1行ずつのまま。
// 金額は元の行の金額を足すだけ（計算し直さない）なので、合計は1件ずつの時と必ず一致する。

export type GroupableInvoiceLine = {
  shiftId?: string | null;
  staffName: string;
  description: string;
  hours: number;
  rate: number;
  amount: number;
  taxRatePercent: number;
};

// 「2026-10-03 勤務（キャディ）（土日祝）」→「キャディ（土日祝）」
// 「2026-10-03 キャンセル料（キャディ）」→「キャンセル料（キャディ）」
export function groupLabel(description: string) {
  const withoutDate = description.replace(/^\d{4}-\d{2}-\d{2}\s+/, "");
  return withoutDate.replace(/^勤務（(.+?)）/, "$1");
}

export function groupInvoiceLines<T extends GroupableInvoiceLine>(lines: T[]): GroupableInvoiceLine[] {
  type Row = GroupableInvoiceLine & { count: number; grouped: boolean };
  const result: Row[] = [];
  const byKey = new Map<string, Row>();
  for (const l of lines) {
    if (!l.shiftId) {
      result.push({ ...l, count: 1, grouped: false });
      continue;
    }
    const label = groupLabel(l.description);
    const key = `${label}\u0000${l.rate}\u0000${l.taxRatePercent}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.hours += l.hours;
      existing.amount += l.amount;
      existing.count += 1;
      continue;
    }
    const group = { shiftId: null, staffName: "", description: label, hours: l.hours, rate: l.rate, amount: l.amount, taxRatePercent: l.taxRatePercent, count: 1, grouped: true };
    byKey.set(key, group);
    result.push(group);
  }
  // 業務の行を先に、手で追加した行（交通費など）をその後に並べる
  const ordered = [...result.filter((r) => r.grouped), ...result.filter((r) => !r.grouped)];
  return ordered.map(({ count, grouped, ...g }) => {
    if (!grouped) return g;
    const hours = Math.round(g.hours * 100) / 100;
    // 時給の業務は数量が時間になるので、何件分かを添える（日給・キャンセル料は数量＝件数）
    return { ...g, hours, description: hours !== count ? `${g.description}（${count}件）` : g.description };
  });
}
