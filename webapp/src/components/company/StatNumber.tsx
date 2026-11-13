// 稼働履歴の上の3つの枠に出す数字（単位は小さく、数字のすぐ後ろに少し空けて付ける）。
// 金額など桁が多い時は、枠からはみ出さないようにスマホでは少し小さくする。
export function StatNumber({ value, unit, className = "" }: { value: string | number; unit: string; className?: string }) {
  const text = typeof value === "number" ? value.toLocaleString() : value;
  const size = text.length > 5 ? "text-base sm:text-lg" : "text-lg";
  return (
    <p className={`whitespace-nowrap font-bold ${size} ${className}`}>
      {text}
      <span className="ml-0.5 text-xs font-semibold">{unit}</span>
    </p>
  );
}
