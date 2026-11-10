// 業務委託のスタッフの請求書の金額計算（画面でもサーバーでも同じ計算にするため、server-onlyにしない）

// 「その他の項目」1行（項目名・数量・単価。金額＝数量×単価）。数量・単価の無い古い行は「1×金額」として読む
export type StaffInvoiceExpense = { label: string; quantity: number; unitPrice: number; amount: number };

const MAX_EXPENSES = 20;

export function isValidTargetMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

// 報酬に対する源泉徴収税額（所得税法204条1項1号等の報酬の一般的な計算：
// 1回の支払が100万円以下なら10.21%、100万円を超える部分は20.42%）。1円未満は切り捨て。
// どの報酬が源泉徴収の対象になるかの判定はアプリではしない（会社がスタッフごとに決める）。
export function computeWithholding(amount: number) {
  if (amount <= 0) return 0;
  if (amount <= 1_000_000) return Math.floor((amount * 1021) / 10000);
  return 102_100 + Math.floor(((amount - 1_000_000) * 2042) / 10000);
}

// 消費税を上乗せする（taxExclusive）場合、源泉徴収は税抜の報酬額に対して計算する
// （請求書で報酬と消費税が区分されていれば税抜で計算できる扱い）。「その他の項目」（交通費など）は
// 実費の精算として、消費税の上乗せ・源泉徴収のどちらの対象にもしない。
export function computeStaffInvoiceTotals(params: {
  workLines: { amount: number }[];
  expenses: StaffInvoiceExpense[];
  withholding: boolean;
  taxExclusive: boolean;
}) {
  const workSubtotal = params.workLines.reduce((sum, l) => sum + l.amount, 0);
  const taxAmount = params.taxExclusive ? Math.floor(workSubtotal * 0.1) : 0;
  const withholdingAmount = params.withholding ? computeWithholding(workSubtotal) : 0;
  const expensesTotal = params.expenses.reduce((sum, e) => sum + e.amount, 0);
  const total = workSubtotal + taxAmount + expensesTotal - withholdingAmount;
  return { workSubtotal, taxAmount, withholdingAmount, expensesTotal, total };
}

export function sanitizeExpenses(raw: unknown): StaffInvoiceExpense[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => {
      const r = (e ?? {}) as { label?: unknown; quantity?: unknown; unitPrice?: unknown; amount?: unknown };
      const label = String(r.label ?? "").trim().slice(0, 60);
      const hasBreakdown = r.unitPrice !== undefined && r.unitPrice !== null;
      // 数量は小数第2位まで（例：1.5時間）。単価は円単位
      const quantity = hasBreakdown ? Math.round(Number(r.quantity ?? 1) * 100) / 100 : 1;
      const unitPrice = Math.round(Number(hasBreakdown ? r.unitPrice : r.amount ?? 0));
      return { label, quantity, unitPrice, amount: Math.round(quantity * unitPrice) };
    })
    .filter(
      (e) =>
        e.label &&
        Number.isFinite(e.quantity) &&
        Number.isFinite(e.unitPrice) &&
        e.quantity > 0 &&
        e.quantity <= 10_000 &&
        e.unitPrice > 0 &&
        e.amount <= 10_000_000,
    )
    .slice(0, MAX_EXPENSES);
}
