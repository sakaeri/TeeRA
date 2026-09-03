"use client";

import { useState, useTransition } from "react";
import {
  addCustomLineAction,
  updateLineAction,
  deleteLineAction,
  updateDeductionsAction,
  updatePaidLeaveAction,
  finalizeSalarySlipAction,
  issueSalarySlipAction,
} from "@/app/company/payroll/actions";

type Line = { id: string; kind: string; description: string; hours: number; rate: number; amount: number };
type Deduction = { id: string; label: string; amount: number };
type Totals = { grossFromShifts: number; paidLeaveAmount: number; gross: number; totalDeductions: number; net: number };
type UnresolvedShift = { shiftId: string; date: string; taskName: string };

export function SalarySlipEditor({
  slip,
}: {
  slip: {
    id: string;
    status: string;
    lines: Line[];
    deductions: Deduction[];
    paidLeaveDaysUsed: number;
    paidLeaveDailyRate: number;
    paidLeaveGrantDays: number;
    totals: Totals;
    unresolved: UnresolvedShift[];
  };
}) {
  const [pending, startTransition] = useTransition();
  const [newLineDesc, setNewLineDesc] = useState("");
  const [newLineHours, setNewLineHours] = useState("");
  const [newLineRate, setNewLineRate] = useState("");
  const [showIssueConfirm, setShowIssueConfirm] = useState(false);

  const isEditable = slip.status === "DRAFT";

  return (
    <div className="flex flex-col gap-6">
      {slip.unresolved.length > 0 ? (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="mb-2 font-semibold">業務内容専用の単価が未設定のため、基本給で計算されているシフトがあります</p>
          <ul className="flex flex-col gap-1">
            {slip.unresolved.map((u) => (
              <li key={u.shiftId}>
                {u.date} ／ {u.taskName}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">スタッフ詳細の「業務内容単価」で該当の業務内容に単価を設定すると、次回の編集画面表示時に自動で反映されます。</p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif-jp text-lg font-bold text-primary">勤務内訳</h2>
          <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
            {slip.status === "DRAFT" ? "下書き" : slip.status === "FINALIZED" ? "確定済み" : "発行済み"}
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1">内容</th>
              <th className="py-1">時間</th>
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
                    `${l.hours}h`
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

        {isEditable ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <input
              type="text"
              placeholder="内容（別の業務を追加）"
              value={newLineDesc}
              onChange={(e) => setNewLineDesc(e.target.value)}
              className="rounded-lg border border-border px-2 py-1.5 text-sm"
            />
            <input
              type="number"
              placeholder="時間"
              value={newLineHours}
              onChange={(e) => setNewLineHours(e.target.value)}
              className="w-20 rounded-lg border border-border px-2 py-1.5 text-sm"
            />
            <input
              type="number"
              placeholder="単価"
              value={newLineRate}
              onChange={(e) => setNewLineRate(e.target.value)}
              className="w-24 rounded-lg border border-border px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              disabled={pending || !newLineDesc || !newLineHours || !newLineRate}
              onClick={() =>
                startTransition(async () => {
                  await addCustomLineAction(slip.id, newLineDesc, Number(newLineHours), Number(newLineRate));
                  setNewLineDesc("");
                  setNewLineHours("");
                  setNewLineRate("");
                })
              }
              className="rounded-lg border border-primary px-3 py-1.5 text-sm text-primary disabled:opacity-60"
            >
              ＋別の業務を追加
            </button>
          </div>
        ) : null}
      </section>

      <PaidLeaveSection slip={slip} isEditable={isEditable} pending={pending} startTransition={startTransition} />
      <DeductionsSection slip={slip} isEditable={isEditable} pending={pending} startTransition={startTransition} />

      <section className="rounded-2xl border-2 border-primary bg-white/60 p-6">
        <div className="flex items-center justify-between text-sm">
          <span>支給合計 {slip.totals.gross}円 ／ 控除合計 {slip.totals.totalDeductions}円</span>
          <span className="text-lg font-bold text-primary">差引支給額 {slip.totals.net}円</span>
        </div>

        {isEditable ? (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(() => finalizeSalarySlipAction(slip.id))}
              className="rounded-lg border border-primary px-4 py-2 text-sm text-primary disabled:opacity-60"
            >
              確定する（課金なし）
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setShowIssueConfirm(true)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              発行する（1 Tee）
            </button>
          </div>
        ) : slip.status === "FINALIZED" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => setShowIssueConfirm(true)}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            発行する（1 Tee）
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => setShowIssueConfirm(true)}
            className="mt-4 rounded-lg border border-primary px-4 py-2 text-sm text-primary disabled:opacity-60"
          >
            再発行する（同月内は無料）
          </button>
        )}

        {showIssueConfirm ? (
          <div className="mt-4 rounded-lg border border-accent bg-accent/10 p-4 text-sm">
            <p className="mb-3">
              {slip.status === "ISSUED"
                ? "同一対象月への再発行は無料です。よろしいですか？"
                : "1Teeを課金して発行します。よろしいですか？"}
            </p>
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

function PaidLeaveSection({
  slip,
  isEditable,
  pending,
  startTransition,
}: {
  slip: { id: string; paidLeaveDaysUsed: number; paidLeaveDailyRate: number; paidLeaveGrantDays: number };
  isEditable: boolean;
  pending: boolean;
  startTransition: (fn: () => void | Promise<void>) => void;
}) {
  const [daysUsed, setDaysUsed] = useState(slip.paidLeaveDaysUsed);
  const [dailyRate, setDailyRate] = useState(slip.paidLeaveDailyRate);

  return (
    <section className="rounded-2xl border border-border bg-white/60 p-6">
      <h2 className="mb-3 font-serif-jp text-lg font-bold text-primary">有給休暇</h2>
      <p className="mb-3 text-xs text-muted">年間付与日数: {slip.paidLeaveGrantDays}日（デフォルト。変更する場合のみ編集）</p>
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
                updatePaidLeaveAction(slip.id, { paidLeaveDaysUsed: daysUsed, paidLeaveDailyRate: dailyRate }),
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
  isEditable,
  pending,
  startTransition,
}: {
  slip: { id: string; deductions: Deduction[] };
  isEditable: boolean;
  pending: boolean;
  startTransition: (fn: () => void | Promise<void>) => void;
}) {
  const [deductions, setDeductions] = useState(slip.deductions);
  const [newLabel, setNewLabel] = useState("");
  const [newAmount, setNewAmount] = useState("");

  function save(next: Deduction[]) {
    setDeductions(next);
    startTransition(() => updateDeductionsAction(slip.id, next));
  }

  return (
    <section className="rounded-2xl border border-border bg-white/60 p-6">
      <h2 className="mb-3 font-serif-jp text-lg font-bold text-primary">控除</h2>
      <div className="flex flex-col gap-2">
        {deductions.map((d, i) => (
          <div key={d.id} className="flex items-center gap-2 text-sm">
            <span className="w-32">{d.label}</span>
            <input
              type="number"
              value={d.amount}
              disabled={!isEditable}
              onChange={(e) => {
                const next = [...deductions];
                next[i] = { ...d, amount: Number(e.target.value) };
                setDeductions(next);
              }}
              onBlur={() => save(deductions)}
              className="w-28 rounded-lg border border-border px-2 py-1 text-sm"
            />
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
        <div className="mt-3 flex items-end gap-2">
          <input
            type="text"
            placeholder="項目名"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="rounded-lg border border-border px-2 py-1.5 text-sm"
          />
          <input
            type="number"
            placeholder="金額"
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
            className="w-24 rounded-lg border border-border px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={pending || !newLabel || !newAmount}
            onClick={() => {
              save([
                ...deductions,
                { id: `custom-${Date.now()}`, label: newLabel, amount: Number(newAmount) },
              ]);
              setNewLabel("");
              setNewAmount("");
            }}
            className="rounded-lg border border-primary px-3 py-1.5 text-sm text-primary disabled:opacity-60"
          >
            ＋追加
          </button>
        </div>
      ) : null}
    </section>
  );
}
