"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 月送りナビと作成対象（スタッフ/依頼主）選択を分離したことに伴い、
// 「＋新しく作成」→ポップアップで対象を選択→明細編集画面へ、という
// 導線を給与計算・請求書の両ページで共通化した部品。
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
  const router = useRouter();

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
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setOpen(false)}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-serif-jp text-lg font-bold text-primary">{label}を選択してください</h3>
              <button type="button" onClick={() => setOpen(false)} className="text-muted">
                ✕
              </button>
            </div>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="mb-4 w-full rounded-lg border border-border px-3 py-2 text-sm"
            >
              <option value="">選択してください</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
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
