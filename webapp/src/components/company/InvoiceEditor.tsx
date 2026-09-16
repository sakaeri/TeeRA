"use client";

import { useState, useTransition } from "react";
import {
  addCustomLineAction,
  updateLineAction,
  deleteLineAction,
  setDueDateAction,
  setNoteAction,
  setInvoiceRegistrationNumberAction,
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

type UnresolvedShift = { shiftId: string; date: string; staffName: string; taskName: string | null };

const STATUS_LABEL: Record<string, string> = { DRAFT: "下書き", ISSUED: "発行済み" };

export function InvoiceEditor({
  invoice,
  willUseFreeQuota,
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
    unresolved: UnresolvedShift[];
  };
  willUseFreeQuota: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [dueDate, setDueDateState] = useState(invoice.dueDate);
  const [note, setNoteState] = useState(invoice.note);
  const [regNumber, setRegNumber] = useState(invoice.invoiceRegistrationNumber);
  const [showIssueConfirm, setShowIssueConfirm] = useState(false);
  const [showAddLineModal, setShowAddLineModal] = useState(false);

  const isEditable = invoice.status === "DRAFT";

  return (
    <div className="flex flex-col gap-6">
      {invoice.unresolved.length > 0 ? (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="mb-2 font-semibold">単価未設定のため明細に計上されていないシフトがあります</p>
          <ul className="flex flex-col gap-1">
            {invoice.unresolved.map((u) => (
              <li key={u.shiftId}>
                {u.date} ／ {u.staffName} ／ {u.taskName ?? "業務内容未選択"}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">設定＞契約関連の「賃金単価・請求単価」で該当の業務内容に単価を設定すると、次回の編集画面表示時に自動で明細に反映されます。</p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif-jp text-lg font-bold text-primary">明細</h2>
          <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
            {STATUS_LABEL[invoice.status] ?? invoice.status}
          </span>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1">スタッフ／内容</th>
              <th className="py-1">数量</th>
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
                    l.hours
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
        <AddInvoiceLineModal
          onClose={() => setShowAddLineModal(false)}
          onSubmit={(fields) =>
            startTransition(async () => {
              await addCustomLineAction(invoice.id, fields);
              setShowAddLineModal(false);
            })
          }
        />
      ) : null}

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
            <input
              type="text"
              value={regNumber}
              disabled={!isEditable}
              onChange={(e) => setRegNumber(e.target.value)}
              onBlur={() => {
                if (isEditable) startTransition(() => setInvoiceRegistrationNumberAction(invoice.id, regNumber));
              }}
              className="rounded-lg border border-border px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            支払期限（必須）
            <input
              type="date"
              value={dueDate}
              disabled={!isEditable}
              onChange={(e) => setDueDateState(e.target.value)}
              onBlur={() => {
                if (isEditable && dueDate) startTransition(() => setDueDateAction(invoice.id, dueDate));
              }}
              className="rounded-lg border border-border px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            備考
            <textarea
              value={note}
              disabled={!isEditable}
              onChange={(e) => setNoteState(e.target.value)}
              onBlur={() => {
                if (isEditable) startTransition(() => setNoteAction(invoice.id, note));
              }}
              rows={2}
              className="rounded-lg border border-border px-2 py-1.5 text-sm"
            />
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
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={pending || !dueDate}
              onClick={() => setShowIssueConfirm(true)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              PDFで請求書を発行する
            </button>
          </div>
        ) : invoice.status === "ISSUED" ? (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(() => reopenInvoiceForEditAction(invoice.id))}
              className="rounded-lg border border-primary px-4 py-2 text-sm text-primary disabled:opacity-60"
            >
              内容を修正する
            </button>
            <button
              type="button"
              disabled={pending || !dueDate}
              onClick={() => setShowIssueConfirm(true)}
              className="rounded-lg border border-primary px-4 py-2 text-sm text-primary disabled:opacity-60"
            >
              PDFで請求書を再発行する（同月内は無料）
            </button>
          </div>
        ) : null}

        {showIssueConfirm ? (
          <div className="mt-4 rounded-lg border border-accent bg-accent/10 p-4 text-sm">
            <p className="mb-3">
              {invoice.status === "ISSUED"
                ? "同一対象月への再発行は無料です。よろしいですか？"
                : willUseFreeQuota
                  ? "今月の無料発行枠を使って発行します（Teeは消費されません）。よろしいですか？"
                  : "1Teeを課金して発行します。よろしいですか？"}
            </p>
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

function AddInvoiceLineModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (fields: { staffName: string; description: string; hours: number; rate: number; taxRatePercent: number }) => void;
}) {
  const [staffName, setStaffName] = useState("");
  const [desc, setDesc] = useState("");
  const [hours, setHours] = useState("");
  const [rate, setRate] = useState("");
  const [taxRatePercent, setTaxRatePercent] = useState("10");
  const canSubmit = staffName && desc && hours && rate;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">明細行を追加</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs">
            スタッフ名
            <input
              type="text"
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              className="rounded-lg border border-border px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            内容（相殺の場合はマイナス金額で）
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
          <label className="flex flex-col gap-1 text-xs">
            消費税区分
            <select
              value={taxRatePercent}
              onChange={(e) => setTaxRatePercent(e.target.value)}
              className="rounded-lg border border-border px-2 py-1.5 text-sm"
            >
              <option value="10">10%</option>
              <option value="8">8%</option>
            </select>
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
            onClick={() =>
              onSubmit({ staffName, description: desc, hours: Number(hours), rate: Number(rate), taxRatePercent: Number(taxRatePercent) })
            }
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            追加する
          </button>
        </div>
      </div>
    </div>
  );
}
