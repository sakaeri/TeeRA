// 請求書・給料明細の「数量」に付ける単位。時給の業務は時間、日給は日、キャンセル料は件。
export type QuantityUnit = "HOUR" | "DAY" | "COUNT";

export const QUANTITY_UNIT_LABEL: Record<QuantityUnit, string> = { HOUR: "時間", DAY: "日", COUNT: "件" };

export function isQuantityUnit(value: unknown): value is QuantityUnit {
  return value === "HOUR" || value === "DAY" || value === "COUNT";
}

// 数量の表示（例：6.5時間・5日・1件。単位が無ければ数字だけ）
export function formatQuantity(quantity: number, unit: string | null | undefined) {
  const n = Math.round(quantity * 100) / 100;
  return isQuantityUnit(unit) ? `${n}${QUANTITY_UNIT_LABEL[unit]}` : String(n);
}
