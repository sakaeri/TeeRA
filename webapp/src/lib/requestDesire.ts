// スタッフが出せるシフト希望の種類（会社がスタッフごとに決める）。
// BOTH=出勤希望と休み希望、WORK=出勤希望だけ、OFF=休み希望だけ
export type AllowedRequestDesire = "BOTH" | "WORK" | "OFF";

export const ALLOWED_REQUEST_DESIRE_OPTIONS: { value: AllowedRequestDesire; label: string }[] = [
  { value: "BOTH", label: "自由選択" },
  { value: "WORK", label: "出勤のみ" },
  { value: "OFF", label: "休みのみ" },
];

export function normalizeAllowedRequestDesire(value: unknown): AllowedRequestDesire {
  return value === "WORK" || value === "OFF" ? value : "BOTH";
}

// その設定で出せる希望（画面に出すボタン）
export function allowedDesires(value: unknown): ("WORK" | "OFF")[] {
  const v = normalizeAllowedRequestDesire(value);
  return v === "BOTH" ? ["WORK", "OFF"] : [v];
}
