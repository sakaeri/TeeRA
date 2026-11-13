// 請求書PDFの明細を「業務×単価×税率」ごとに1行にまとめる。
// シフト由来の行（shiftIdあり）だけをまとめ、手で追加した行（交通費など）は1行ずつのまま。
// 金額は元の行の金額を足すだけ（計算し直さない）なので、合計は1件ずつの時と必ず一致する。

export type GroupableInvoiceLine = {
  shiftId?: string | null;
  staffName: string;
  description: string;
  hours: number;
  // 数量の単位（HOUR/DAY/COUNT）。まとめる時は単位が同じ行だけをまとめる
  unit?: string | null;
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

// PDFの明細の載せ方：業務×単価ごと／スタッフ×業務×単価ごと／1件ずつ（以前に発行したもの）
export type InvoiceLineLayout = "TASK" | "STAFF_TASK" | "DETAIL";

export function layoutInvoiceLines<T extends GroupableInvoiceLine>(lines: T[], layout: InvoiceLineLayout): GroupableInvoiceLine[] {
  if (layout === "DETAIL") return lines;
  return groupInvoiceLines(lines, { byStaff: layout === "STAFF_TASK" });
}

// byStaff=trueなら「スタッフ ／ 業務」ごとにまとめ、スタッフ名順に並べる
export function groupInvoiceLines<T extends GroupableInvoiceLine>(lines: T[], options: { byStaff?: boolean } = {}): GroupableInvoiceLine[] {
  const byStaff = options.byStaff ?? false;
  type Row = GroupableInvoiceLine & { count: number; grouped: boolean };
  const result: Row[] = [];
  const byKey = new Map<string, Row>();
  for (const l of lines) {
    if (!l.shiftId) {
      result.push({ ...l, count: 1, grouped: false });
      continue;
    }
    const taskLabel = groupLabel(l.description);
    const label = byStaff && l.staffName ? `${l.staffName} ／ ${taskLabel}` : taskLabel;
    const key = `${byStaff ? l.staffName : ""}\u0000${taskLabel}\u0000${l.rate}\u0000${l.taxRatePercent}\u0000${l.unit ?? ""}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.hours += l.hours;
      existing.amount += l.amount;
      existing.count += 1;
      continue;
    }
    const group = { shiftId: null, staffName: byStaff ? l.staffName : "", description: label, hours: l.hours, unit: l.unit ?? null, rate: l.rate, amount: l.amount, taxRatePercent: l.taxRatePercent, count: 1, grouped: true };
    byKey.set(key, group);
    result.push(group);
  }
  // 業務の行を先に、手で追加した行（交通費など）をその後に並べる
  const groupedRows = result.filter((r) => r.grouped);
  // スタッフごとのときは、同じ人の業務が続けて並ぶようにスタッフ名順（同じ人の中は元の順）
  if (byStaff) groupedRows.sort((a, b) => a.staffName.localeCompare(b.staffName, "ja"));
  const ordered = [...groupedRows, ...result.filter((r) => !r.grouped)];
  return ordered.map(({ count, grouped, ...g }) => {
    if (!grouped) return g;
    // スタッフ名は内容の欄に入れたので、PDFで二重に出さない
    g.staffName = "";
    const hours = Math.round(g.hours * 100) / 100;
    // 時給の業務は数量が時間になるので、何件分かを添える（日給・キャンセル料は数量＝件数）
    return { ...g, hours, description: hours !== count ? `${g.description}（${count}件）` : g.description };
  });
}

// 発行時のスナップショットから載せ方を読む。lineLayoutが無い以前の発行分は、
// groupLinesByTask=trueなら業務ごと、それ以外（未設定・false＝当時の「1件ずつ」）は1件ずつ。
export function invoiceLineLayoutFromSnapshot(snap: Record<string, unknown>): InvoiceLineLayout {
  const layout = snap.lineLayout;
  if (layout === "TASK" || layout === "STAFF_TASK" || layout === "DETAIL") return layout;
  return snap.groupLinesByTask === true ? "TASK" : "DETAIL";
}
