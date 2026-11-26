"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAllowanceAction, setAllowanceArchivedAction, updateAllowanceAction } from "@/app/company/allowanceActions";

export type AllowanceRow = {
  id: string;
  name: string;
  amountType: "FIXED" | "VARIABLE";
  staffAmount: number | null;
  billToClient: boolean;
  clientAmount: number | null;
  staffCanReport: boolean;
  archived: boolean;
};

const yen = (n: number) => `${n.toLocaleString()}円`;

export function allowanceSummary(a: AllowanceRow) {
  const amount = a.amountType === "VARIABLE" ? "金額は毎回入れる" : yen(a.staffAmount ?? 0);
  const bill = a.billToClient
    ? a.amountType === "FIXED" && a.clientAmount != null && a.clientAmount !== a.staffAmount
      ? `依頼主に${yen(a.clientAmount)}を請求`
      : "依頼主にも請求"
    : "依頼主には請求しない";
  return `${amount}・${bill}・${a.staffCanReport ? "スタッフも報告で選べる" : "会社だけが付ける"}`;
}

type FormState = {
  name: string;
  amountType: "FIXED" | "VARIABLE";
  staffAmount: string;
  billToClient: boolean;
  clientAmount: string;
  staffCanReport: boolean;
};

const EMPTY: FormState = { name: "", amountType: "FIXED", staffAmount: "", billToClient: false, clientAmount: "", staffCanReport: true };

// 設定＞手当：名前は自由に作れる。決まった金額か毎回入れるか・依頼主にも請求するか・スタッフも選べるかを決める
export function AllowancesSettings({ allowances }: { allowances: AllowanceRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const active = allowances.filter((a) => !a.archived);
  const archived = allowances.filter((a) => a.archived);

  function open(a: AllowanceRow | null) {
    setError(null);
    setEditing(a ? a.id : "new");
    setForm(
      a
        ? {
            name: a.name,
            amountType: a.amountType,
            staffAmount: a.staffAmount != null ? String(a.staffAmount) : "",
            billToClient: a.billToClient,
            clientAmount: a.clientAmount != null ? String(a.clientAmount) : "",
            staffCanReport: a.staffCanReport,
          }
        : EMPTY,
    );
  }

  function save() {
    setError(null);
    const input = {
      name: form.name,
      amountType: form.amountType,
      staffAmount: form.amountType === "FIXED" ? Number(form.staffAmount) : null,
      billToClient: form.billToClient,
      clientAmount: form.amountType === "FIXED" && form.billToClient && form.clientAmount ? Number(form.clientAmount) : null,
      staffCanReport: form.staffCanReport,
    };
    startTransition(async () => {
      const r = editing === "new" ? await createAllowanceAction(input) : await updateAllowanceAction(editing!, input);
      if (r.status === "error") {
        setError(r.reason);
        return;
      }
      setEditing(null);
      router.refresh();
    });
  }

  function archive(a: AllowanceRow, value: boolean) {
    startTransition(async () => {
      await setAllowanceArchivedAction(a.id, value);
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-3" data-testid="allowances-settings">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-serif-jp text-lg font-bold text-primary">手当</h2>
          <p className="text-xs text-muted">帯同手当・チップなど、勤務に上乗せするもの。給料明細・スタッフの請求書に入ります。</p>
        </div>
        <button
          type="button"
          onClick={() => open(null)}
          className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
        >
          ＋手当を追加
        </button>
      </div>
      {active.length === 0 ? <p className="py-6 text-center text-sm text-muted">手当はまだありません。</p> : null}
      <ul className="flex flex-col gap-2">
        {active.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-white p-3 text-sm" data-testid="allowance-row">
            <span className="min-w-0">
              <span className="block font-semibold">{a.name}</span>
              <span className="block text-xs text-muted">{allowanceSummary(a)}</span>
            </span>
            <span className="flex shrink-0 items-center gap-3 text-xs">
              <button type="button" onClick={() => open(a)} className="font-semibold text-primary underline">
                変更
              </button>
              <button type="button" disabled={pending} onClick={() => archive(a, true)} className="text-muted hover:text-red-600">
                しまう
              </button>
            </span>
          </li>
        ))}
      </ul>
      {archived.length > 0 ? (
        <div className="text-xs">
          <button type="button" onClick={() => setShowArchived((v) => !v)} className="text-muted underline">
            {showArchived ? "▲ しまった手当を閉じる" : `▼ しまった手当（${archived.length}件）`}
          </button>
          {showArchived ? (
            <ul className="mt-1.5 flex flex-col gap-1">
              {archived.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 rounded-md bg-background px-3 py-1.5">
                  <span>{a.name}</span>
                  <button type="button" disabled={pending} onClick={() => archive(a, false)} className="text-primary underline">
                    戻す
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setEditing(null)}>
          <div
            role="dialog"
            aria-label="手当"
            className="max-h-popup w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-serif-jp text-base font-bold text-primary">{editing === "new" ? "手当を追加" : "手当を変更"}</h4>
              <button type="button" onClick={() => setEditing(null)} aria-label="閉じる" className="text-muted hover:text-primary">
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-3 text-sm">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted">名前</span>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="例：帯同手当、チップ"
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                  aria-label="手当の名前"
                />
              </label>
              <div className="flex flex-col gap-1 text-xs">
                <span className="text-muted">金額</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { value: "FIXED" as const, label: "決まった金額" },
                    { value: "VARIABLE" as const, label: "毎回入れる" },
                  ].map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setForm({ ...form, amountType: o.value })}
                      className={`rounded-lg border px-2 py-2 font-semibold ${
                        form.amountType === o.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-white"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {form.amountType === "FIXED" ? (
                  <input
                    type="number"
                    min="1"
                    value={form.staffAmount}
                    onChange={(e) => setForm({ ...form, staffAmount: e.target.value })}
                    placeholder="1回の金額（円）"
                    className="mt-1 rounded-lg border border-border px-3 py-2 text-sm"
                    aria-label="1回の金額"
                  />
                ) : (
                  <span className="mt-1 text-muted">付ける時に、その日の金額を入れます（チップなど）。</span>
                )}
              </div>
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={form.billToClient}
                  onChange={(e) => setForm({ ...form, billToClient: e.target.checked })}
                  className="mt-0.5"
                />
                <span>
                  依頼主にも請求する
                  <span className="block text-muted">依頼主への請求書に、勤務ごとの行で入ります。</span>
                </span>
              </label>
              {form.billToClient && form.amountType === "FIXED" ? (
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted">依頼主に請求する金額（空欄ならスタッフに払う金額と同じ）</span>
                  <input
                    type="number"
                    min="1"
                    value={form.clientAmount}
                    onChange={(e) => setForm({ ...form, clientAmount: e.target.value })}
                    className="rounded-lg border border-border px-3 py-2 text-sm"
                    aria-label="依頼主に請求する金額"
                  />
                </label>
              ) : null}
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={form.staffCanReport}
                  onChange={(e) => setForm({ ...form, staffCanReport: e.target.checked })}
                  className="mt-0.5"
                />
                <span>
                  スタッフも業務報告で選べる
                  <span className="block text-muted">外すと、会社だけが付けられます。</span>
                </span>
              </label>
              {editing !== "new" ? <p className="text-xs text-muted">変えた内容は、これから付ける分から使われます（もう付けた勤務の金額は変わりません）。</p> : null}
              {error ? <p className="text-xs text-red-600">{error}</p> : null}
              <button
                type="button"
                disabled={pending}
                onClick={save}
                className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
