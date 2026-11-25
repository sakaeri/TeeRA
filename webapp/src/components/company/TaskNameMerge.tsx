"use client";

import { useEffect, useState, useTransition } from "react";
import {
  alignStaffRateNamesAction,
  getTaskNameMergeOptionsAction,
  listStaffRateNameMismatchesAction,
  mergeTaskNamesAction,
  previewTaskNameMergeAction,
} from "@/app/company/contracts/actions";

type Options = Awaited<ReturnType<typeof getTaskNameMergeOptionsAction>>;
type Preview = Awaited<ReturnType<typeof previewTaskNameMergeAction>>;

// 似た名前のまとまりから、残す方（単価に登録している名前があればそれ）とまとめる方を決める
function defaultPair(group: string[], rateNames: string[]) {
  const registered = group.filter((n) => rateNames.includes(n));
  const to = registered.length === 1 ? registered[0] : group[0];
  const from = group.find((n) => n !== to) ?? "";
  return { from, to };
}

// 「業務内容が分かれています（キャディ業務／キャディー）→まとめる」の案内。似た名前が無ければ何も出さない
export function TaskNameSplitNotice({ relationshipId, onMerged }: { relationshipId: string; onMerged?: () => void | Promise<void> }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [open, setOpen] = useState<{ from: string; to: string } | null>(null);

  async function load() {
    try {
      setOptions(await getTaskNameMergeOptionsAction(relationshipId));
    } catch {
      setOptions(null);
    }
  }
  useEffect(() => {
    let cancelled = false;
    getTaskNameMergeOptionsAction(relationshipId)
      .then((o) => {
        if (!cancelled) setOptions(o);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [relationshipId]);

  if (!options || options.similar.length === 0) return null;
  return (
    <>
      {options.similar.map((group) => (
        <div
          key={group.join("/")}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900"
          data-testid="task-name-split-notice"
        >
          <span>
            業務内容が分かれています（{group.join("／")}）。同じ仕事ならまとめると、請求書の行も1つになります。
          </span>
          <button
            type="button"
            onClick={() => setOpen(defaultPair(group, options.rateNames))}
            className="shrink-0 rounded-md border border-amber-700/40 bg-white px-2.5 py-1 font-semibold"
          >
            まとめる
          </button>
        </div>
      ))}
      {open ? (
        <TaskNameMergeModal
          relationshipId={relationshipId}
          initialFrom={open.from}
          initialTo={open.to}
          onClose={() => setOpen(null)}
          onMerged={async () => {
            setOpen(null);
            await load();
            await onMerged?.();
          }}
        />
      ) : null}
    </>
  );
}

// 業務内容をまとめるポップアップ。「まとめる方」の名前を「残す方」の名前にそろえる（その依頼主の分だけ）
export function TaskNameMergeModal({
  relationshipId,
  initialFrom = "",
  initialTo = "",
  onClose,
  onMerged,
}: {
  relationshipId: string;
  initialFrom?: string;
  initialTo?: string;
  onClose: () => void;
  onMerged: () => void | Promise<void>;
}) {
  const [names, setNames] = useState<string[] | null>(null);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getTaskNameMergeOptionsAction(relationshipId)
      .then((o) => {
        if (!cancelled) setNames(o.names);
      })
      .catch(() => {
        if (!cancelled) setNames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [relationshipId]);

  useEffect(() => {
    let cancelled = false;
    if (!from || !to || from === to) return;
    previewTaskNameMergeAction(relationshipId, from, to)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      setPreview(null);
    };
  }, [relationshipId, from, to]);

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await mergeTaskNamesAction(relationshipId, from, to);
        await onMerged();
      } catch {
        setError("まとめられませんでした。もう一度お試しください。");
      }
    });
  }

  const selectClass = "w-full rounded-lg border border-border bg-white px-2 py-2 text-sm";
  const ready = Boolean(from && to && from !== to);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="業務内容をまとめる"
        className="max-h-popup w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        data-testid="task-name-merge-modal"
      >
        <div className="mb-3 flex items-center justify-between">
          <h4 className="font-serif-jp text-base font-bold text-primary">業務内容をまとめる</h4>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-muted hover:text-primary">
            ✕
          </button>
        </div>
        <p className="mb-3 text-xs text-muted">同じ仕事が別の名前で入っている時に、1つの名前にそろえます。この依頼主の分だけ変わります。</p>
        {names === null ? (
          <p className="py-4 text-center text-sm text-muted">読み込み中…</p>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">まとめる方（この名前は無くなります）</span>
              <select value={from} onChange={(e) => setFrom(e.target.value)} className={selectClass} data-testid="merge-from">
                <option value="">選んでください</option>
                {names.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">残す方（この名前にそろえます）</span>
              <select value={to} onChange={(e) => setTo(e.target.value)} className={selectClass} data-testid="merge-to">
                <option value="">選んでください</option>
                {names
                  .filter((n) => n !== from)
                  .map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
              </select>
            </label>
            {ready && preview ? (
              <div className="rounded-lg bg-background px-3 py-2 text-xs" data-testid="merge-preview">
                <p>
                  「{from}」のシフト{preview.shiftCount}件
                  {preview.reportCount > 0 ? `・業務報告${preview.reportCount}件` : ""}
                  {preview.fromRateLabel ? `・単価（${preview.fromRateLabel}）` : ""}を、「{to}」にまとめます。
                </p>
                <p className="mt-1 text-muted">まだ発行していない請求書も「{to}」で作り直します。発行済みの請求書は変わりません。</p>
                {preview.rateDiffers ? (
                  <p className="mt-1 font-semibold text-amber-800">
                    単価が違います（{from}：{preview.fromRateLabel}／{to}：{preview.toRateLabel}）。まとめると「{to}」の単価になります。
                  </p>
                ) : null}
              </div>
            ) : null}
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
            <button
              type="button"
              disabled={pending || !ready}
              onClick={submit}
              className="w-full rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground disabled:opacity-50"
            >
              {pending ? "まとめています…" : "まとめる"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// 取引先の単価タブ：スタッフの単価で、取引先の業務内容に無い名前（以前シフトから自動で作られた「キャディ」など）を
// 取引先の名前（「キャディ業務」）にまとめてそろえる。名前がずれていると、入れた単価が使われず基本給で計算されてしまう
export function StaffRateAlignNotice({ relationshipId, onAligned }: { relationshipId: string; onAligned?: () => void | Promise<void> }) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof listStaffRateNameMismatchesAction>> | null>(null);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listStaffRateNameMismatchesAction(relationshipId)
      .then((r) => {
        if (!cancelled) setItems(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [relationshipId]);

  if (!items || items.length === 0) return null;
  const staffCount = new Set(items.map((i) => i.staffName)).size;
  return (
    <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="staff-rate-align-notice">
      <p>
        スタッフの単価で、この取引先の業務内容と名前がずれているものがあります（{staffCount}人分）。名前がずれていると、入れた単価が使われず基本給で計算されます。
      </p>
      <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 underline">
        {open ? "▲ 閉じる" : "▼ 中身を見る"}
      </button>
      {open ? (
        <ul className="mt-1 flex flex-col gap-0.5">
          {items.map((i) => (
            <li key={i.staffTaskRateId}>
              {i.staffName}：{i.from}
              {i.priced ? "" : "（単価未設定）"} → {i.to}
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await alignStaffRateNamesAction(relationshipId);
            setItems(await listStaffRateNameMismatchesAction(relationshipId));
            await onAligned?.();
          })
        }
        className="mt-2 block rounded-md border border-amber-700/40 bg-white px-2.5 py-1 font-semibold disabled:opacity-60"
      >
        取引先の名前にそろえる
      </button>
    </div>
  );
}
