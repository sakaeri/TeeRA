"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 月送りナビと作成対象（スタッフ/依頼主）選択を分離したことに伴い、
// 「＋新しく作成」→ポップアップで対象を選択→明細編集画面へ、という
// 導線を給与計算・請求書の両ページで共通化した部品。件数が多い会社でも
// 選びやすいよう、名前で絞り込む検索欄付きのリストにしている
// （呼び出し元は、この月に既に下書き/発行済みがある対象をあらかじめ
// optionsから除外して渡す）。
export function CreateRecordButton({
  basePath,
  targetMonth,
  paramName,
  label,
  options,
}: {
  basePath: string;
  targetMonth: string;
  paramName: string;
  label: string;
  options: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const router = useRouter();

  const filteredOptions = options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()));

  function close() {
    setOpen(false);
    setSelected("");
    setQuery("");
  }

  function handleCreate() {
    if (!selected) return;
    const params = new URLSearchParams({ month: targetMonth, [paramName]: selected });
    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        ＋新しく作成
      </button>
      {open ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={close}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-serif-jp text-lg font-bold text-primary">{label}を選択してください</h3>
              <button type="button" onClick={close} className="text-muted">
                ✕
              </button>
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`${label}名で検索`}
              className="mb-2 w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
            <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border border-border">
              {filteredOptions.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted">見つかりません。</p>
              ) : (
                filteredOptions.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setSelected(o.id)}
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-background ${
                      selected === o.id ? "bg-primary/10 font-semibold text-primary" : ""
                    }`}
                  >
                    {o.name}
                  </button>
                ))
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-lg px-4 py-2 text-sm text-muted hover:bg-background"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!selected}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
              >
                作成へ進む
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
