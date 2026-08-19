"use client";

import { useState, useTransition } from "react";
import {
  updateLineAction,
  deleteLineAction,
  setDueDateAction,
  setNoteAction,
  setInvoiceRegistrationNumberAction,
  confirmInvoiceAction,
  issueInvoiceAction,
  reopenInvoiceForEditAction,
} from "@/app/company/invoices/actions";

type Line = {
  id: string;
  staffName: string;
  description: string;
  hours: number;
  rate: number;
  amount: number;
  taxRatePercent: number;
};

type Totals = {
  brackets: { rate: number; subtotal: number; tax: number }[];
  subtotalAll: number;
  taxAll: number;
  total: number;
};

const STATUS_LABEL: Record<string, string> = { DRAFT: "下書き", CONFIRMED: "確定済み", ISSUED: "発行済み" };

export function InvoiceEditor({
  invoice,
}: {
  invoice: {
    id: string;
    status: string;
    dueDate: string;
    note: string;
    invoiceRegistrationNumber: string;
    registered: boolean;
    lines: Line[];
    totals: Totals;
  };
}) {
  const [pending, startTransition] = useTransition();
  const [dueDate, setDueDateState] = useState(invoice.dueDate);
  const [note, setNoteState] = useState(invoice.note);
  const [regNumber, setRegNumber] = useState(invoice.invoiceRegistrationNumber);
  const [showIssueConfirm, setShowIssueConfirm] = useState(false);

  const isEditable = invoice.status === "DRAFT";

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif-jp text-lg font-bold text-primary">明細</h2>
          <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
            {STATUS_LABEL[invoice.status] ?? invoice.status}
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1">スタッフ／内容</th>
              <th className="py-1">時間</th>
              <th className="py-1">単価</th>
              <th className="py-1">税率</th>
              <th className="py-1">金額</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.id} className="border-b border-border/60">
                <td className="py-1">
                  {l.staffName} / {l.description}
                </td>
                <td className="py-1">
                  {isEditable ? (
                    <input
                      type="number"
                      defaultValue={l.hours}
                      onBlur={(e) => startTransition(() => updateLineAction(l.id, { hours: Number(e.target.value) }))}
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
                      onBlur={(e) => startTransition(() => updateLineAction(l.id, { rate: Number(e.target.value) }))}
                      className="w-20 rounded border border-border px-1 py-0.5"
                    />
                  ) : (
                    `${l.rate}円`
                  )}
                </td>
                <td className="py-1">
                  {isEditable ? (
                    <select
                      defaultValue={l.taxRatePercent}
                      onChange={(e) =>
                        startTransition(() => updateLineAction(l.id, { taxRatePercent: Number(e.target.value) }))
                      }
                      className="rounded border border-border px-1 py-0.5"
                    >
                      <option value={10}>10%</option>
                      <option value={8}>8%</option>
                    </select>
                  ) : (
                    `${l.taxRatePercent}%`
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
            {invoice.lines.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-center text-muted">
                  対象のシフトがありません。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <h2 className="mb-3 font-serif-jp text-lg font-bold text-primary">消費税区分</h2>
        {invoice.totals.brackets.map((b) => (
          <div key={b.rate} className="flex justify-between border-b border-border/60 py-1 text-sm">
            <span>{b.rate}%対象</span>
            <span>
              小計 {b.subtotal}円 ／ 消費税 {b.tax}円
            </span>
          </div>
        ))}
        {!invoice.registered ? (
          <p className="mt-2 text-xs text-red-600">登録なし（適格請求書発行事業者登録なし）— 税抜きで発行されます。</p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <h2 className="mb-3 font-serif-jp text-lg font-bold text-primary">請求書情報</h2>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs">
            インボイス登録番号
            <div className="flex gap-2">
              <input
                type="text"
                value={regNumber}
                disabled={!isEditable}
                onChange={(e) => setRegNumber(e.target.value)}
                className="flex-1 rounded-lg border border-border px-2 py-1.5 text-sm"
              />
              {isEditable ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => setInvoiceRegistrationNumberAction(invoice.id, regNumber))}
                  className="rounded-lg border border-primary px-3 py-1.5 text-xs text-primary"
                >
                  保存
                </button>
              ) : null}
            </div>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            支払期限（必須）
            <div className="flex gap-2">
              <input
                type="date"
                value={dueDate}
                disabled={!isEditable}
                onChange={(e) => setDueDateState(e.target.value)}
                className="rounded-lg border border-border px-2 py-1.5 text-sm"
              />
              {isEditable ? (
                <button
                  type="button"
                  disabled={pending || !dueDate}
                  onClick={() => startTransition(() => setDueDateAction(invoice.id, dueDate))}
                  className="rounded-lg border border-primary px-3 py-1.5 text-xs text-primary"
                >
                  保存
                </button>
              ) : null}
            </div>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            備考
            <div className="flex gap-2">
              <textarea
                value={note}
                disabled={!isEditable}
                onChange={(e) => setNoteState(e.target.value)}
                rows={2}
                className="flex-1 rounded-lg border border-border px-2 py-1.5 text-sm"
              />
              {isEditable ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => setNoteAction(invoice.id, note))}
                  className="self-start rounded-lg border border-primary px-3 py-1.5 text-xs text-primary"
                >
                  保存
                </button>
              ) : null}
            </div>
          </label>
        </div>
      </section>

      <section className="rounded-2xl border-2 border-primary bg-white/60 p-6">
        <div className="flex items-center justify-between text-sm">
          <span>
            小計 {invoice.totals.subtotalAll}円 ／ 消費税合計 {invoice.totals.taxAll}円
          </span>
          <span className="text-lg font-bold text-primary">合計金額 {invoice.totals.total}円</span>
        </div>

        {isEditable ? (
          <button
            type="button"
            disabled={pending || !dueDate}
            onClick={() => startTransition(() => confirmInvoiceAction(invoice.id))}
            className="mt-4 rounded-lg border border-primary px-4 py-2 text-sm text-primary disabled:opacity-60"
          >
            確定する（課金なし）
          </button>
        ) : invoice.status === "CONFIRMED" ? (
          <button
            type="button"
            disabled={pending || !dueDate}
            onClick={() => setShowIssueConfirm(true)}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            発行する（1 Tee）
          </button>
        ) : invoice.status === "ISSUED" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => reopenInvoiceForEditAction(invoice.id))}
            className="mt-4 rounded-lg border border-primary px-4 py-2 text-sm text-primary disabled:opacity-60"
          >
            内容を修正する
          </button>
        ) : null}

        {showIssueConfirm ? (
          <div className="mt-4 rounded-lg border border-accent bg-accent/10 p-4 text-sm">
            <p className="mb-3">1Teeを課金して発行します。よろしいですか？</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await issueInvoiceAction(invoice.id);
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
