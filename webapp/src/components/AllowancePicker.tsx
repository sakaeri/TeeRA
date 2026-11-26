"use client";

// 勤務に付ける手当を選ぶ欄（帯同手当・チップなど）。決まった金額の手当はチェックだけ、
// 毎回入れる手当はチェックすると金額の欄が出る。会社・スタッフの両方の画面で使う。

export type AllowanceOption = {
  id: string;
  name: string;
  amountType: "FIXED" | "VARIABLE";
  staffAmount: number | null;
};

// 選んだ手当（キー＝手当のID、値＝毎回入れる手当の金額。決まった金額の手当は空文字）
export type AllowanceSelection = Record<string, string>;

export function selectionToItems(selection: AllowanceSelection) {
  return Object.entries(selection).map(([allowanceId, amount]) => ({ allowanceId, amount: amount ? Number(amount) : null }));
}

export function selectionFromAllowances(list: { allowanceId: string; amount: number }[], options: AllowanceOption[]): AllowanceSelection {
  const variable = new Set(options.filter((o) => o.amountType === "VARIABLE").map((o) => o.id));
  return Object.fromEntries(list.map((a) => [a.allowanceId, variable.has(a.allowanceId) ? String(a.amount) : ""]));
}

// 毎回入れる手当で、金額が入っていないものの名前（保存する前に知らせる）
export function missingAmounts(selection: AllowanceSelection, options: AllowanceOption[]) {
  return options.filter((o) => o.amountType === "VARIABLE" && o.id in selection && !(Number(selection[o.id]) > 0)).map((o) => o.name);
}

export function AllowancePicker({
  options,
  value,
  onChange,
}: {
  options: AllowanceOption[];
  value: AllowanceSelection;
  onChange: (next: AllowanceSelection) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 text-sm" data-testid="allowance-picker">
      {options.map((o) => {
        const checked = o.id in value;
        return (
          <div key={o.id} className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  const next = { ...value };
                  if (e.target.checked) next[o.id] = "";
                  else delete next[o.id];
                  onChange(next);
                }}
                className="h-4 w-4 accent-primary"
                aria-label={o.name}
              />
              <span>
                {o.name}
                {o.amountType === "FIXED" && o.staffAmount != null ? (
                  <span className="ml-1 text-xs text-muted">{o.staffAmount.toLocaleString()}円</span>
                ) : null}
              </span>
            </label>
            {checked && o.amountType === "VARIABLE" ? (
              <input
                type="number"
                min="1"
                inputMode="numeric"
                value={value[o.id]}
                onChange={(e) => onChange({ ...value, [o.id]: e.target.value })}
                placeholder="金額（円）"
                aria-label={`${o.name}の金額`}
                className="w-28 rounded-lg border border-border px-2 py-1 text-sm"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
