"use client";

import { useEffect, useState, useTransition } from "react";
import {
  addCustomLineAction,
  updateLineAction,
  deleteLineAction,
  updateDeductionsAction,
  updatePaidLeaveAction,
  issueSalarySlipAction,
  reopenSalarySlipAction,
  renameUnresolvedTaskNamesAction,
} from "@/app/company/payroll/actions";

type Line = { id: string; kind: string; description: string; hours: number; rate: number; amount: number };
// ratePercentは「雇用保険料」欄で率（例：0.6）を入力したときに、その月の
// 支給合計から逆算した金額と一緒に保存しておく表示用の値。次に開いたとき
// 入力した率を再表示できるようにするためのもので、他の月や他のスタッフに
// は引き継がない（都度その月の支給合計で計算し直す運用）。
// quantity/unitPriceは、追加した控除項目を数量×単価で管理したい場合の
// 表示用の値（例：弁当代 3回×300円）。どちらも無ければ金額を直接入力する
// 従来通りの扱いになる。
type Deduction = { id: string; label: string; amount: number; ratePercent?: number; quantity?: number; unitPrice?: number };
type Totals = { grossFromShifts: number; paidLeaveAmount: number; gross: number; totalDeductions: number; net: number };
type UnresolvedShift = { shiftId: string; workReportId: string; date: string; taskName: string; source: "workReport" | "shift" };

export function SalarySlipEditor({
  slip,
  staffName,
  willUseFreeQuota,
  pdfQuota,
}: {
  slip: {
    id: string;
    status: string;
    lines: Line[];
    deductions: Deduction[];
    paidLeaveDaysUsed: number;
    paidLeaveDailyRate: number;
    paidLeaveBalance: number;
    paidLeaveNextGrantDate: string | null;
    totals: Totals;
    unresolved: UnresolvedShift[];
    issues: { id: string }[];
  };
  staffName: string;
  willUseFreeQuota: boolean;
  pdfQuota: { remaining: number; quota: number } | null;
}) {
  const [pending, startTransition] = useTransition();
  const [showAddLineModal, setShowAddLineModal] = useState(false);
  const [showIssueConfirm, setShowIssueConfirm] = useState(false);

  const isEditable = slip.status === "DRAFT";

  // 同月内の再発行、および無料枠内の発行は確認を挟まずそのまま発行する。
  // Teeを実際に課金する時だけ確認ダイアログを出す（無料なのに確認を
  // 挟まれるのは煩わしいという指摘への対応）。
  function issueOrConfirm() {
    if (slip.issues.length > 0 || willUseFreeQuota) {
      startTransition(() => issueSalarySlipAction(slip.id));
    } else {
      setShowIssueConfirm(true);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="-mt-2 text-sm text-muted">
        対象スタッフ：<span className="font-semibold text-foreground">{staffName}</span>
      </p>

      {slip.unresolved.length > 0 ? <UnresolvedWarning salarySlipId={slip.id} unresolved={slip.unresolved} /> : null}

      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif-jp text-lg font-bold text-primary">勤務内訳</h2>
          <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
            {slip.status === "DRAFT" ? "下書き" : "発行済み"}
          </span>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1">内容</th>
              <th className="py-1">数量</th>
              <th className="py-1">単価</th>
              <th className="py-1">金額</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {slip.lines.map((l) => (
              <tr key={l.id} className="border-b border-border/60">
                <td className="py-1">{l.description}</td>
                <td className="py-1">
                  {isEditable ? (
                    <input
                      type="number"
                      defaultValue={l.hours}
                      onBlur={(e) =>
                        startTransition(() => updateLineAction(l.id, Number(e.target.value), l.rate))
                      }
                      className="w-16 rounded border border-border px-1 py-0.5"
                    />
                  ) : (
                    l.hours
                  )}
                </td>
                <td className="py-1">
                  {isEditable ? (
                    <input
                      type="number"
                      defaultValue={l.rate}
                      onBlur={(e) =>
                        startTransition(() => updateLineAction(l.id, l.hours, Number(e.target.value)))
                      }
                      className="w-20 rounded border border-border px-1 py-0.5"
                    />
                  ) : (
                    `${l.rate}円`
                  )}
                </td>
                <td className="py-1">{l.amount}円</td>
                <td className="py-1 text-right">
                  {isEditable ? (
                    <button
                      type="button"
                      onClick={() => startTransition(() => deleteLineAction(l.id))}
                      className="text-xs text-red-600"
                    >
                      ✕
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {isEditable ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowAddLineModal(true)}
              className="rounded-lg border border-primary px-3 py-1.5 text-sm text-primary"
            >
              ＋追加
            </button>
          </div>
        ) : null}
      </section>

      {showAddLineModal ? (
        <AddLineModal
          title="勤務内訳に行を追加"
          onClose={() => setShowAddLineModal(false)}
          onSubmit={(desc, hours, rate) =>
            startTransition(async () => {
              await addCustomLineAction(slip.id, desc, hours, rate);
              setShowAddLineModal(false);
            })
          }
        />
      ) : null}

      <PaidLeaveSection slip={slip} isEditable={isEditable} pending={pending} startTransition={startTransition} />
      <DeductionsSection slip={slip} gross={slip.totals.gross} isEditable={isEditable} startTransition={startTransition} />

      <section className="rounded-2xl border-2 border-primary bg-white/60 p-6">
        <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span>支給合計 {slip.totals.gross}円 ／ 控除合計 {slip.totals.totalDeductions}円</span>
          <span className="text-lg font-bold text-primary">差引支給額 {slip.totals.net}円</span>
        </div>

        {isEditable ? (
          <div className="mt-4 flex flex-col gap-2">
            {pdfQuota ? (
              <p className="text-xs text-muted">
                今月の無料発行枠（給与明細・請求書の合算）：残り{pdfQuota.remaining}/{pdfQuota.quota}件
              </p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={issueOrConfirm}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                PDFで明細を発行する
              </button>
            </div>
          </div>
        ) : (
          // 発行済みのPDFは下の発行履歴から直接開けるため、何も編集して
          // いない状態での「再発行する」ボタンは、同じ内容の重複PDFが
          // 増えるだけで実質的な意味が無く、紛らわしいので置かない。
          // 発行し直したい場合は「内容を修正する」→編集→発行、の流れになる。
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(() => reopenSalarySlipAction(slip.id))}
              className="rounded-lg border border-primary px-4 py-2 text-sm text-primary disabled:opacity-60"
            >
              内容を修正する
            </button>
          </div>
        )}

        {showIssueConfirm ? (
          <div className="mt-4 rounded-lg border border-accent bg-accent/10 p-4 text-sm">
            {/* willUseFreeQuotaの時はissueOrConfirmが確認を挟まず即発行する
                ため、ここに来るのは必ずTee課金が発生するケースだけ。 */}
            <p className="mb-3">1Teeを課金して発行します。よろしいですか？</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await issueSalarySlipAction(slip.id);
                    setShowIssueConfirm(false);
                  })
                }
                className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground"
              >
                発行する
              </button>
              <button
                type="button"
                onClick={() => setShowIssueConfirm(false)}
                className="rounded-lg border border-border px-4 py-1.5 text-sm"
              >
                キャンセル
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function AddLineModal({
  title,
  onClose,
  onSubmit,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (desc: string, hours: number, rate: number) => void;
}) {
  const [desc, setDesc] = useState("");
  const [hours, setHours] = useState("");
  const [rate, setRate] = useState("");
  const canSubmit = desc && hours && rate;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">{title}</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs">
            内容
            <input
              type="text"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="rounded-lg border border-border px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            数量
            <input
              type="number"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="rounded-lg border border-border px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            単価
            <input
              type="number"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="rounded-lg border border-border px-2 py-1.5 text-sm"
            />
          </label>
        </div>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold"
          >
            キャンセル
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onSubmit(desc, Number(hours), Number(rate))}
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            追加する
          </button>
        </div>
      </div>
    </div>
  );
}

function UnresolvedWarning({ salarySlipId, unresolved }: { salarySlipId: string; unresolved: UnresolvedShift[] }) {
  const [pending, startTransition] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showRenameForm, setShowRenameForm] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");

  function toggle(shiftId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(shiftId)) next.delete(shiftId);
      else next.add(shiftId);
      return next;
    });
  }

  function submitRename() {
    if (!newTaskName.trim() || selectedIds.size === 0) return;
    const items = unresolved
      .filter((u) => selectedIds.has(u.shiftId))
      .map((u) => ({ shiftId: u.shiftId, workReportId: u.workReportId, source: u.source }));
    startTransition(async () => {
      await renameUnresolvedTaskNamesAction(salarySlipId, items, newTaskName);
      setSelectedIds(new Set());
      setShowRenameForm(false);
      setNewTaskName("");
    });
  }

  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="mb-2 font-semibold">業務内容専用の単価が未設定のため、基本給で計算されているシフトがあります</p>
      <ul className="flex flex-col gap-1">
        {unresolved.map((u) => (
          <li key={u.shiftId} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selectedIds.has(u.shiftId)}
              onChange={() => toggle(u.shiftId)}
              disabled={pending}
            />
            <span>
              {u.date} ／ {u.taskName}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs">
        スタッフ詳細の「業務内容単価」で該当の業務内容に単価を設定するか、表記ゆれ（例：「キャディ」と「キャディ業務」）が原因の場合は下でまとめて業務内容名を直せます。次回の編集画面表示時に自動で反映されます。
      </p>

      {!showRenameForm ? (
        <button
          type="button"
          disabled={selectedIds.size === 0}
          onClick={() => setShowRenameForm(true)}
          className="mt-3 rounded-lg border border-amber-400 px-3 py-1.5 text-xs text-amber-900 disabled:opacity-60"
        >
          選択した{selectedIds.size}件の業務内容名をまとめて変更
        </button>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5 text-xs">
            正しい業務内容名
            <input
              type="text"
              value={newTaskName}
              onChange={(e) => setNewTaskName(e.target.value)}
              placeholder="例：キャディ業務"
              className="rounded-lg border border-amber-400 bg-white px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <button
            type="button"
            disabled={pending || !newTaskName.trim()}
            onClick={submitRename}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            {selectedIds.size}件を変更する
          </button>
          <button
            type="button"
            onClick={() => {
              setShowRenameForm(false);
              setNewTaskName("");
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs"
          >
            キャンセル
          </button>
        </div>
      )}
    </section>
  );
}

function PaidLeaveSection({
  slip,
  isEditable,
  pending,
  startTransition,
}: {
  slip: {
    id: string;
    paidLeaveDaysUsed: number;
    paidLeaveDailyRate: number;
    paidLeaveBalance: number;
    paidLeaveNextGrantDate: string | null;
  };
  isEditable: boolean;
  pending: boolean;
  startTransition: (fn: () => void | Promise<void>) => void;
}) {
  const [daysUsed, setDaysUsed] = useState(slip.paidLeaveDaysUsed);
  const [dailyRate, setDailyRate] = useState(slip.paidLeaveDailyRate);

  return (
    <section className="rounded-2xl border border-border bg-white/60 p-6">
      <h2 className="mb-3 font-serif-jp text-lg font-bold text-primary">有給休暇</h2>
      <p className="mb-3 text-xs text-muted">
        残日数: {slip.paidLeaveBalance}日
        {slip.paidLeaveNextGrantDate ? `／次回付与予定日: ${slip.paidLeaveNextGrantDate}` : ""}
        （付与・繰越はスタッフ詳細から管理します）
      </p>
      <div className="flex items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">
          使用日数
          <input
            type="number"
            value={daysUsed}
            disabled={!isEditable}
            onChange={(e) => setDaysUsed(Number(e.target.value))}
            className="w-20 rounded-lg border border-border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          日額
          <input
            type="number"
            value={dailyRate}
            disabled={!isEditable}
            onChange={(e) => setDailyRate(Number(e.target.value))}
            className="w-24 rounded-lg border border-border px-2 py-1.5 text-sm"
          />
        </label>
        {isEditable ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(() =>
                updatePaidLeaveAction(slip.id, {
                  paidLeaveDaysUsed: daysUsed,
                  paidLeaveDailyRate: dailyRate,
                }),
              )
            }
            className="rounded-lg border border-primary px-3 py-1.5 text-sm text-primary disabled:opacity-60"
          >
            保存
          </button>
        ) : null}
      </div>
    </section>
  );
}

function DeductionsSection({
  slip,
  gross,
  isEditable,
  startTransition,
}: {
  slip: { id: string; deductions: Deduction[] };
  gross: number;
  isEditable: boolean;
  startTransition: (fn: () => void | Promise<void>) => void;
}) {
  const [deductions, setDeductions] = useState(slip.deductions);
  const [showAddModal, setShowAddModal] = useState(false);

  function save(next: Deduction[]) {
    setDeductions(next);
    startTransition(() => updateDeductionsAction(slip.id, next));
  }

  // 率指定（雇用保険料）の控除は、支給合計（勤務内訳の編集等）が変わる
  // たびに金額を自動で再計算する。以前は率の入力欄を一度消して入れ直す
  // までは古い支給合計のままの金額が残ってしまうバグがあった。
  useEffect(() => {
    Promise.resolve().then(() => {
      setDeductions((prev) => {
        let changed = false;
        const next = prev.map((d) => {
          if (d.ratePercent == null) return d;
          const amount = Math.round((gross * d.ratePercent) / 100);
          if (amount === d.amount) return d;
          changed = true;
          return { ...d, amount };
        });
        if (!changed) return prev;
        startTransition(() => updateDeductionsAction(slip.id, next));
        return next;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gross]);

  return (
    <section className="rounded-2xl border border-border bg-white/60 p-6">
      <h2 className="mb-3 font-serif-jp text-lg font-bold text-primary">控除</h2>
      <div className="flex flex-col gap-2">
        {deductions.map((d, i) => (
          <div key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-32">{d.label}</span>
            {d.label === "雇用保険料" ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.01"
                  key={`${d.id}-rate-${d.ratePercent ?? ""}`}
                  defaultValue={d.ratePercent ?? ""}
                  disabled={!isEditable}
                  placeholder="率"
                  // 率を入力すると支給合計×率で金額欄を自動計算する。率は
                  // この月のこの欄にだけ記録される表示用の値で、他の月や
                  // 他のスタッフには引き継がない（都度その月の支給合計で
                  // 計算し直す運用のため）。
                  onBlur={(e) => {
                    const rateStr = e.target.value;
                    if (rateStr === "") {
                      const next = [...deductions];
                      next[i] = { ...d, ratePercent: undefined };
                      save(next);
                      return;
                    }
                    const rate = Number(rateStr);
                    const amount = Math.round((gross * rate) / 100);
                    const next = [...deductions];
                    next[i] = { ...d, amount, ratePercent: rate };
                    save(next);
                  }}
                  className="w-16 rounded-lg border border-border px-2 py-1 text-sm"
                />
                <span className="text-xs text-muted">%（＝{d.amount}円）</span>
              </div>
            ) : d.quantity != null && d.unitPrice != null ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  key={`${d.id}-qty-${d.quantity}`}
                  defaultValue={d.quantity}
                  disabled={!isEditable}
                  onBlur={(e) => {
                    const quantity = Number(e.target.value);
                    if (quantity === d.quantity) return;
                    const unitPrice = d.unitPrice ?? 0;
                    const next = [...deductions];
                    next[i] = { ...d, quantity, amount: Math.round(quantity * unitPrice) };
                    save(next);
                  }}
                  className="w-14 rounded-lg border border-border px-2 py-1 text-sm"
                />
                <span className="text-xs text-muted">×</span>
                <input
                  type="number"
                  key={`${d.id}-unit-${d.unitPrice}`}
                  defaultValue={d.unitPrice}
                  disabled={!isEditable}
                  onBlur={(e) => {
                    const unitPrice = Number(e.target.value);
                    if (unitPrice === d.unitPrice) return;
                    const quantity = d.quantity ?? 0;
                    const next = [...deductions];
                    next[i] = { ...d, unitPrice, amount: Math.round(quantity * unitPrice) };
                    save(next);
                  }}
                  className="w-20 rounded-lg border border-border px-2 py-1 text-sm"
                />
                <span className="text-xs text-muted">円（＝{d.amount}円）</span>
              </div>
            ) : (
              <>
                <input
                  type="number"
                  defaultValue={d.amount}
                  key={`${d.id}-amt-${d.amount}`}
                  disabled={!isEditable}
                  // valueで常に制御すると、入力中に先頭の0が消えずに残り
                  // 続けるブラウザのnumber inputの挙動（例：08900のように
                  // 表示されてしまう）があるため、他の金額欄（勤務内訳の
                  // 時間/単価等）と同じくdefaultValue+onBlurの非制御方式に
                  // する。
                  onBlur={(e) => {
                    const amount = Number(e.target.value);
                    if (amount === d.amount) return;
                    const next = [...deductions];
                    next[i] = { ...d, amount };
                    save(next);
                  }}
                  className="w-28 rounded-lg border border-border px-2 py-1 text-sm"
                />
                <span className="text-xs text-muted">円</span>
              </>
            )}
            {d.id.startsWith("custom-") && isEditable ? (
              <button
                type="button"
                onClick={() => save(deductions.filter((x) => x.id !== d.id))}
                className="text-xs text-red-600"
              >
                削除
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {isEditable ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="rounded-lg border border-primary px-3 py-1.5 text-sm text-primary"
          >
            ＋追加
          </button>
        </div>
      ) : null}

      {showAddModal ? (
        <AddDeductionModal
          onClose={() => setShowAddModal(false)}
          onSubmit={(label, quantity, unitPrice) => {
            save([
              ...deductions,
              { id: `custom-${Date.now()}`, label, amount: Math.round(quantity * unitPrice), quantity, unitPrice },
            ]);
            setShowAddModal(false);
          }}
        />
      ) : null}
    </section>
  );
}

function AddDeductionModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (label: string, quantity: number, unitPrice: number) => void;
}) {
  const [label, setLabel] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const canSubmit = label && quantity && unitPrice;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">控除項目を追加</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs">
            項目名
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="rounded-lg border border-border px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            数量
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="rounded-lg border border-border px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            単価
            <input
              type="number"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              className="rounded-lg border border-border px-2 py-1.5 text-sm"
            />
          </label>
        </div>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold"
          >
            キャンセル
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onSubmit(label, Number(quantity), Number(unitPrice))}
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            追加する
          </button>
        </div>
      </div>
    </div>
  );
}
