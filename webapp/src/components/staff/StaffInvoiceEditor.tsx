"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PdfLink } from "@/components/PdfLink";
import { saveStaffInvoiceAction } from "@/app/staff/actions";
import { computeStaffInvoiceTotals, sanitizeExpenses, type StaffInvoiceExpense } from "@/lib/staffInvoiceTotals";

type Invoice = {
  id: string | null;
  status: "DRAFT" | "SUBMITTED" | "RETURNED" | "APPROVED";
  editable: boolean;
  workLines: { shiftId: string; description: string; hours: number; rate: number; amount: number }[];
  expenses: StaffInvoiceExpense[];
  note: string;
  issuerName: string;
  issuerAddress: string;
  registrationNumber: string;
  bank: { bankName: string | null; branchName: string | null; accountType: string | null; accountNumber: string | null; accountHolderName: string | null };
  withholding: boolean;
  taxExclusive: boolean;
  workSubtotal: number;
  taxAmount: number;
  withholdingAmount: number;
  expensesTotal: number;
  total: number;
  pendingReportCount: number;
  submittedAt: string | null;
  reviewedAt: string | null;
  returnReason: string | null;
};

const yen = (n: number) => `${n.toLocaleString()}円`;

// 業務の行（"YYYY-MM-DD 勤務（業務内容）（日給）"）を、日付と内容に分けて見やすくする
function splitLine(description: string) {
  const date = description.match(/^\d{4}-(\d{2})-(\d{2})/);
  const rest = description.replace(/^\d{4}-\d{2}-\d{2} 勤務/, "").replace(/（日給）$/, "");
  return {
    date: date ? `${Number(date[1])}/${Number(date[2])}` : "",
    label: rest.replace(/^（(.+)）/, "$1").replace(/）（/g, "・").replace(/[（）]/g, "") || "勤務",
    isDaily: description.endsWith("（日給）"),
  };
}

export function StaffInvoiceEditor({
  companyId,
  companyName,
  targetMonth,
  invoice,
}: {
  companyId: string;
  companyName: string;
  targetMonth: string;
  invoice: Invoice;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expenses, setExpenses] = useState<StaffInvoiceExpense[]>(invoice.expenses);
  // 「その他の項目」の入力ポップアップ（index=null は新しく足す）
  const [itemForm, setItemForm] = useState<{ index: number | null; label: string; quantity: string; unitPrice: string } | null>(null);
  const [note, setNote] = useState(invoice.note);
  const [issuerName, setIssuerName] = useState(invoice.issuerName);
  const [issuerAddress, setIssuerAddress] = useState(invoice.issuerAddress);
  const [registrationNumber, setRegistrationNumber] = useState(invoice.registrationNumber);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const editable = invoice.editable;

  const cleanExpenses = sanitizeExpenses(expenses);
  const totals = editable
    ? computeStaffInvoiceTotals({ workLines: invoice.workLines, expenses: cleanExpenses, withholding: invoice.withholding, taxExclusive: invoice.taxExclusive })
    : invoice;
  const bankFilled = Boolean(invoice.bank.bankName && invoice.bank.accountNumber);

  function save(submit: boolean) {
    setMessage(null);
    if (submit && !confirm(`${companyName}に請求書を提出します。提出すると、会社が確認するまで直せません。よろしいですか？`)) return;
    startTransition(async () => {
      const result = await saveStaffInvoiceAction({
        companyId,
        targetMonth,
        submit,
        input: { expenses: cleanExpenses, note, issuerName, issuerAddress, registrationNumber },
      });
      if (result.ok) {
        setMessage({ ok: true, text: submit ? "請求書を提出しました ✓ 会社が確認すると、お知らせが届きます。" : "下書きを保存しました ✓" });
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  const card = "rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5";
  const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm disabled:bg-background disabled:text-muted";

  return (
    <div className="flex flex-col gap-4" data-testid="staff-invoice-editor">
      {invoice.status === "SUBMITTED" ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">提出済みです。会社が確認するまでお待ちください。</p>
      ) : invoice.status === "APPROVED" ? (
        <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">会社が承認しました ✓</p>
      ) : invoice.status === "RETURNED" ? (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-semibold">会社から差し戻されました。直して、もう一度提出してください。</p>
          {invoice.returnReason ? <p className="mt-1 whitespace-pre-wrap">理由：{invoice.returnReason}</p> : null}
        </div>
      ) : null}

      {editable && invoice.pendingReportCount > 0 ? (
        <p className="rounded-2xl bg-background px-4 py-3 text-xs text-muted">
          この月に、まだ会社が承認していない業務報告が{invoice.pendingReportCount}件あります。承認されるまで請求書には入りません。
        </p>
      ) : null}

      <section className={card}>
        <h2 className="mb-2 text-sm font-semibold text-primary">勤務（承認済みの業務報告から自動で入ります）</h2>
        {invoice.workLines.length === 0 ? (
          <p className="text-sm text-muted">この月の承認済みの勤務はまだありません。</p>
        ) : (
          <ul className="divide-y divide-border/60 text-sm">
            {invoice.workLines.map((l) => {
              const v = splitLine(l.description);
              return (
                <li key={l.shiftId} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="mr-2 text-muted">{v.date}</span>
                    {v.label}
                    <span className="ml-2 text-xs text-muted">
                      {v.isDaily ? "1日" : `${l.hours}時間`} × {yen(l.rate)}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium">{yen(l.amount)}</span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">金額は会社が決めた単価で計算されます。違っている時は、会社に連絡してください。</p>
      </section>

      <section className={card}>
        <h2 className="mb-2 text-sm font-semibold text-primary">その他の項目</h2>
        {expenses.length === 0 && !editable ? <p className="text-sm text-muted">なし</p> : null}
        <ul className="divide-y divide-border/60 text-sm">
          {expenses.map((e, i) => (
            <li key={i}>
              <button
                type="button"
                disabled={!editable}
                onClick={() => setItemForm({ index: i, label: e.label, quantity: String(e.quantity), unitPrice: String(e.unitPrice) })}
                className="flex w-full items-center justify-between gap-3 py-2 text-left disabled:cursor-default"
              >
                <span className="min-w-0">
                  {e.label}
                  <span className="ml-2 text-xs text-muted">
                    {e.quantity} × {yen(e.unitPrice)}
                  </span>
                </span>
                <span className="shrink-0 font-medium">{yen(e.amount)}</span>
              </button>
            </li>
          ))}
        </ul>
        {editable && expenses.length < 20 ? (
          <button
            type="button"
            onClick={() => setItemForm({ index: null, label: "", quantity: "1", unitPrice: "" })}
            className="mt-2 rounded-lg border border-dashed border-primary/50 px-3 py-1.5 text-xs font-semibold text-primary"
          >
            ＋その他の項目を足す
          </button>
        ) : null}
        <p className="mt-2 text-xs text-muted">
          交通費などの実費の精算として、消費税・源泉徴収はかけずに計算します。手当など報酬にあたるものは、会社に相談してください。
        </p>
      </section>

      <section className={card}>
        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">報酬（勤務）</dt>
            <dd>{yen(totals.workSubtotal)}</dd>
          </div>
          {invoice.taxExclusive ? (
            <div className="flex justify-between">
              <dt className="text-muted">消費税（10%）</dt>
              <dd>{yen(totals.taxAmount)}</dd>
            </div>
          ) : null}
          {invoice.withholding ? (
            <div className="flex justify-between">
              <dt className="text-muted">源泉徴収税</dt>
              <dd>−{yen(totals.withholdingAmount)}</dd>
            </div>
          ) : null}
          {totals.expensesTotal > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted">その他の項目</dt>
              <dd>{yen(totals.expensesTotal)}</dd>
            </div>
          ) : null}
          <div className="mt-1 flex justify-between border-t border-border pt-2 text-base font-bold text-primary">
            <dt>ご請求金額</dt>
            <dd data-testid="staff-invoice-total">{yen(totals.total)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted">
          消費税は{invoice.taxExclusive ? "報酬に10%を上乗せ" : "報酬に含む"}、源泉徴収は{invoice.withholding ? "あり" : "なし"}です（会社の設定です）。
        </p>
      </section>

      <section className={card}>
        <h2 className="mb-2 text-sm font-semibold text-primary">請求する人</h2>
        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted">
            名前
            <input className={input} value={issuerName} disabled={!editable} onChange={(e) => setIssuerName(e.target.value)} />
          </label>
          <label className="text-xs text-muted">
            住所
            <input className={input} value={issuerAddress} disabled={!editable} onChange={(e) => setIssuerAddress(e.target.value)} />
          </label>
          <label className="text-xs text-muted">
            インボイスの登録番号（持っている人だけ。例：T1234567890123）
            <input
              className={input}
              value={registrationNumber}
              disabled={!editable}
              placeholder="無ければ空欄のまま"
              onChange={(e) => setRegistrationNumber(e.target.value)}
            />
          </label>
          <div className="text-xs text-muted">
            振込先
            <p className="mt-1 rounded-lg bg-background px-3 py-2 text-sm text-foreground">
              {bankFilled
                ? `${invoice.bank.bankName} ${invoice.bank.branchName ?? ""} ${invoice.bank.accountType ?? ""} ${invoice.bank.accountNumber} ${invoice.bank.accountHolderName ?? ""}`
                : "未登録"}
            </p>
            {editable ? (
              <Link href={`/staff/contracts/${companyId}`} className="mt-1 inline-block text-primary underline">
                振込先を{bankFilled ? "直す" : "登録する"}（契約書の画面）
              </Link>
            ) : null}
          </div>
          <label className="text-xs text-muted">
            備考（任意）
            <textarea className={input} rows={2} value={note} disabled={!editable} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
      </section>

      {message ? (
        <p className={`rounded-xl px-4 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>{message.text}</p>
      ) : null}

      {editable ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => save(false)}
            className="rounded-lg border border-primary px-4 py-2.5 text-sm font-semibold text-primary disabled:opacity-60"
          >
            下書きを保存
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => save(true)}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {invoice.status === "RETURNED" ? "直して提出する" : "提出する"}
          </button>
        </div>
      ) : null}

      {invoice.id && invoice.status !== "DRAFT" ? (
        <PdfLink href={`/api/staff-invoices/${invoice.id}/pdf`} className="text-center text-sm font-semibold text-primary underline">
          請求書のPDFを見る
        </PdfLink>
      ) : null}
      {itemForm ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={() => setItemForm(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()} data-testid="staff-invoice-item-form">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-serif-jp text-lg font-bold text-primary">{itemForm.index === null ? "その他の項目を足す" : "その他の項目を直す"}</h3>
              <button type="button" onClick={() => setItemForm(null)} className="text-muted" aria-label="閉じる">
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs text-muted">
                項目名
                <input
                  className={input}
                  placeholder="例：交通費（10/5 電車）・備品代など"
                  value={itemForm.label}
                  onChange={(e) => setItemForm({ ...itemForm, label: e.target.value })}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-muted">
                  数量
                  <input
                    className={`${input} text-right`}
                    inputMode="decimal"
                    value={itemForm.quantity}
                    onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value.replace(/[^\d.]/g, "") })}
                  />
                </label>
                <label className="text-xs text-muted">
                  単価（円）
                  <input
                    className={`${input} text-right`}
                    inputMode="numeric"
                    value={itemForm.unitPrice}
                    onChange={(e) => setItemForm({ ...itemForm, unitPrice: e.target.value.replace(/[^\d]/g, "") })}
                  />
                </label>
              </div>
              <p className="text-right text-sm">
                金額 <span className="font-semibold text-primary">{yen(Math.round((Number(itemForm.quantity) || 0) * (Number(itemForm.unitPrice) || 0)))}</span>
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              {itemForm.index !== null ? (
                <button
                  type="button"
                  onClick={() => {
                    setExpenses(expenses.filter((_, j) => j !== itemForm.index));
                    setItemForm(null);
                  }}
                  className="rounded-lg px-3 py-2 text-sm text-red-700"
                >
                  消す
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                disabled={sanitizeExpenses([{ label: itemForm.label, quantity: Number(itemForm.quantity), unitPrice: Number(itemForm.unitPrice) }]).length === 0}
                onClick={() => {
                  const [item] = sanitizeExpenses([{ label: itemForm.label, quantity: Number(itemForm.quantity), unitPrice: Number(itemForm.unitPrice) }]);
                  if (!item) return;
                  setExpenses(itemForm.index === null ? [...expenses, item] : expenses.map((x, j) => (j === itemForm.index ? item : x)));
                  setItemForm(null);
                }}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
              >
                {itemForm.index === null ? "追加する" : "直す"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
