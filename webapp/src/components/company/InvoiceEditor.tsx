"use client";

import { useState, useTransition } from "react";
import {
  addCustomLineAction,
  updateLineAction,
  deleteLineAction,
  setDueDateAction,
  setNoteAction,
  setPdfLayoutAction,
  selectInvoiceBankAccountAction,
  addBankAccountAction,
  deleteBankAccountAction,
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

type BankAccount = {
  id: string;
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  accountHolderName: string;
};
type BankFields = Omit<BankAccount, "id">;

function sameBank(a: BankFields, b: BankFields) {
  return (
    a.bankName === b.bankName &&
    a.branchName === b.branchName &&
    a.accountType === b.accountType &&
    a.accountNumber === b.accountNumber &&
    a.accountHolderName === b.accountHolderName
  );
}

type UnresolvedShift = { shiftId: string; date: string; staffName: string; taskName: string | null };

const STATUS_LABEL: Record<string, string> = { DRAFT: "下書き", ISSUED: "発行済み" };

export function InvoiceEditor({
  invoice,
  clientName,
  clientRelationshipId,
  willUseFreeQuota,
  pdfQuota,
  bankAccounts = [],
}: {
  // 登録済みの振込先（請求書ごとに選ぶ）
  bankAccounts?: BankAccount[];
  // 単価が無いときに、その依頼主の「単価」タブを開くため
  clientRelationshipId?: string;
  invoice: {
    id: string;
    status: string;
    dueDate: string;
    note: string;
    invoiceRegistrationNumber: string;
    registered: boolean;
    bankName: string;
    branchName: string;
    accountType: string;
    accountNumber: string;
    accountHolderName: string;
    lines: Line[];
    totals: Totals;
    unresolved: UnresolvedShift[];
    issues: { id: string }[];
    groupLinesByTask: boolean;
    attachWorkRecord: boolean;
  };
  clientName: string;
  willUseFreeQuota: boolean;
  pdfQuota: { remaining: number; quota: number; unlimited?: boolean } | null;
}) {
  const [pending, startTransition] = useTransition();
  const [dueDate, setDueDateState] = useState(invoice.dueDate);
  const [note, setNoteState] = useState(invoice.note);
  const [regNumber, setRegNumber] = useState(invoice.invoiceRegistrationNumber);
  const [showIssueConfirm, setShowIssueConfirm] = useState(false);
  const [showAddLineModal, setShowAddLineModal] = useState(false);
  // 押したらすぐ切り替わって見えるように、画面側でも持っておく
  const [groupLinesByTask, setGroupLinesByTask] = useState(invoice.groupLinesByTask);
  const [attachWorkRecord, setAttachWorkRecord] = useState(invoice.attachWorkRecord);

  const isEditable = invoice.status === "DRAFT";

  // 同月内の再発行、および無料枠内の発行は確認を挟まずそのまま発行する。
  // Teeを実際に課金する時だけ確認ダイアログを出す（無料なのに確認を
  // 挟まれるのは煩わしいという指摘への対応）。
  function issueOrConfirm() {
    if (invoice.issues.length > 0 || willUseFreeQuota) {
      startTransition(() => issueInvoiceAction(invoice.id));
    } else {
      setShowIssueConfirm(true);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="-mt-2 text-sm text-muted">
        請求先：<span className="font-semibold text-foreground">{clientName}</span>
      </p>

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
          <p className="mt-2 text-xs">
            名簿の「依頼主」から{clientName}を開き、「単価」タブで該当の業務内容の請求単価を設定すると、この画面を開き直したときに自動で明細に入ります。
          </p>
          {clientRelationshipId ? (
            <a
              href={`/company/roster?client=${clientRelationshipId}&clientTab=rates`}
              className="mt-3 inline-block rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white"
            >
              {clientName}の単価を設定する →
            </a>
          ) : null}
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
              <th className="py-1">内容</th>
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
                  {l.staffName ? `${l.staffName} / ` : ""}
                  {l.description}
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
                      <option value={0}>なし</option>
                    </select>
                  ) : (
                    l.taxRatePercent === 0 ? "なし" : `${l.taxRatePercent}%`
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

      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <h2 className="mb-3 font-serif-jp text-lg font-bold text-primary">消費税区分</h2>
        {invoice.totals.brackets.map((b) => (
          <div key={b.rate} className="flex justify-between border-b border-border/60 py-1 text-sm">
            <span>{b.rate === 0 ? "対象外" : `${b.rate}%対象`}</span>
            <span>
              小計 {b.subtotal}円 ／ 消費税 {b.tax}円
            </span>
          </div>
        ))}
        {!invoice.registered ? (
          <p className="mt-2 text-xs text-red-600">登録なし（適格請求書発行事業者登録なし）— 税抜きで発行されます。</p>
        ) : null}
        <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span>
            小計 {invoice.totals.subtotalAll.toLocaleString()}円 ／ 消費税合計 {invoice.totals.taxAll.toLocaleString()}円
          </span>
          <span className="text-lg font-bold text-primary">合計金額 {invoice.totals.total.toLocaleString()}円</span>
        </div>
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

        <BankAccountPicker
          invoiceId={invoice.id}
          isEditable={isEditable}
          accounts={bankAccounts}
          current={{
            bankName: invoice.bankName,
            branchName: invoice.branchName,
            accountType: invoice.accountType,
            accountNumber: invoice.accountNumber,
            accountHolderName: invoice.accountHolderName,
          }}
        />
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

      <section className="rounded-2xl border-2 border-primary bg-white/60 p-6">
        <h2 className="mb-3 font-serif-jp text-lg font-bold text-primary">PDFの載せ方</h2>
        <p className="mb-1 text-xs text-muted">明細</p>
        <div role="radiogroup" aria-label="明細の載せ方" className="mb-1 flex gap-2">
          {[
            { value: true, label: "業務ごとにまとめる" },
            { value: false, label: "1件ずつ" },
          ].map((o) => {
            const selected = groupLinesByTask === o.value;
            return (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!isEditable}
                onClick={() => {
                  setGroupLinesByTask(o.value);
                  startTransition(() => setPdfLayoutAction(invoice.id, { groupLinesByTask: o.value }));
                }}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-60 ${
                  selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-white text-foreground"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <p className="mb-4 text-xs text-muted">
          {groupLinesByTask
            ? "業務と単価が同じシフトを1行にまとめ、時間（日給は日数）を合計して載せます。上の一覧は1件ずつのまま直せます。"
            : "シフト1件ずつを明細に載せます。"}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={attachWorkRecord}
            disabled={!isEditable}
            onChange={(e) => {
              const checked = e.target.checked;
              setAttachWorkRecord(checked);
              startTransition(() => setPdfLayoutAction(invoice.id, { attachWorkRecord: checked }));
            }}
            className="h-4 w-4"
          />
          実績表を付ける（2ページ目以降に、この請求書に載ったシフトの日付・スタッフ・時間）
        </label>
        {isEditable ? (
          <a
            href={`/api/invoices/${invoice.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-block text-sm font-semibold text-primary underline"
          >
            見本のPDFを見る
          </a>
        ) : null}

        {isEditable ? (
          <div className="mt-4 flex flex-col gap-2">
            {pdfQuota ? (
              <p className="text-xs text-muted">
                {pdfQuota.unlimited
                  ? "PDF発行は無制限です（エンタープライズプラン）"
                  : `今月の無料発行枠（給与明細・請求書の合算）：残り${pdfQuota.remaining}/${pdfQuota.quota}件`}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending || !dueDate}
                onClick={issueOrConfirm}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                PDFで請求書を発行する
              </button>
            </div>
          </div>
        ) : invoice.status === "ISSUED" ? (
          // 発行済みのPDFは下の発行履歴から直接開けるため、何も編集して
          // いない状態での「再発行する」ボタンは、同じ内容の重複PDFが
          // 増えるだけで実質的な意味が無く、紛らわしいので置かない。
          // 発行し直したい場合は「内容を修正する」→編集→発行、の流れになる。
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(() => reopenInvoiceForEditAction(invoice.id))}
              className="rounded-lg border border-primary px-4 py-2 text-sm text-primary disabled:opacity-60"
            >
              内容を修正する
            </button>
          </div>
        ) : null}

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
  // スタッフ名は必須にしない — まとめて業務内容×単価×数量で計上する行
  // （特定のスタッフに紐付かない明細）もあるため。
  const canSubmit = desc && hours && rate;

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
            スタッフ名（任意）
            <input
              type="text"
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              className="rounded-lg border border-border px-2 py-1.5 text-sm"
            />
          </label>
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
            単価（相殺の場合はマイナス金額で）
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
              <option value="0">なし</option>
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


const NONE = "__none__";
const CURRENT = "__current__";

// 請求書の振込先：登録済みの振込先から選ぶ／載せない／＋振込先を追加。
// 選んだ内容は請求書に写す（登録を消しても、この請求書の振込先は残る）。
function BankAccountPicker({
  invoiceId,
  isEditable,
  accounts,
  current,
}: {
  invoiceId: string;
  isEditable: boolean;
  accounts: BankAccount[];
  current: BankFields;
}) {
  const [pending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [open, setOpen] = useState(false);
  const isEmpty = !current.bankName && !current.accountNumber && !current.accountHolderName;
  const matched = accounts.find((a) => sameBank(a, current));
  // 登録を消した振込先や、以前に手で入れた振込先は「この請求書の振込先」として出す
  const value = isEmpty ? NONE : (matched?.id ?? CURRENT);
  const [selected, setSelected] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setSelected(value);
  }
  const options = [
    ...accounts.map((a) => ({ key: a.id, fields: a as BankFields | null, note: null as string | null })),
    ...(value === CURRENT ? [{ key: CURRENT, fields: current as BankFields | null, note: "この請求書の振込先（登録は削除済み）" }] : []),
    { key: NONE, fields: null as BankFields | null, note: null as string | null },
  ];
  const selectedOption = options.find((o) => o.key === selected);

  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-1 text-xs">振込先</p>
      {/* 見た目は今までのプルダウンのまま。標準のプルダウンは選択肢の中で改行できないため、
          同じ形の枠を押すと、銀行・口座番号・名義を行に分けた一覧が開くようにしている */}
      <div className="relative">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="振込先"
          disabled={!isEditable || pending}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-left disabled:opacity-70"
        >
          <span className="min-w-0 flex-1">
            {selectedOption?.fields ? (
              <BankCardText fields={selectedOption.fields} note={selectedOption.note} />
            ) : (
              <span className="block text-sm">振込先を載せない</span>
            )}
          </span>
          {isEditable ? (
            <span aria-hidden className="shrink-0 text-xs text-muted">
              ⌃⌄
            </span>
          ) : null}
        </button>
        {open ? (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <ul
              role="listbox"
              aria-label="振込先の選択肢"
              className="absolute left-0 right-0 z-40 mt-1 max-h-80 overflow-y-auto rounded-xl border border-border bg-white py-1 shadow-lg"
            >
              {options.map((o) => {
                const checked = selected === o.key;
                return (
                  <li key={o.key}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={checked}
                      onClick={() => {
                        setOpen(false);
                        if (o.key === CURRENT || o.key === selected) return;
                        setSelected(o.key);
                        startTransition(() => selectInvoiceBankAccountAction(invoiceId, o.key === NONE ? null : o.key));
                      }}
                      className="flex w-full items-start gap-2 border-b border-border/60 px-3 py-2.5 text-left last:border-b-0"
                    >
                      <span aria-hidden className="w-4 shrink-0 text-sm text-primary">
                        {checked ? "✓" : ""}
                      </span>
                      {o.fields ? <BankCardText fields={o.fields} note={o.note} /> : <span className="text-sm">振込先を載せない</span>}
                    </button>
                  </li>
                );
              })}
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setShowAdd(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-primary"
                >
                  <span aria-hidden className="w-4 shrink-0" />
                  ＋振込先を追加
                </button>
              </li>
            </ul>
          </>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted">
        {selected === NONE
          ? "PDFに「お振込先」の欄を出しません（契約で振込先が決まっている場合など）。"
          : "翌月の請求書は、ここで選んだ振込先で始まります。"}
      </p>
      {isEditable && accounts.length > 0 ? (
        <button type="button" onClick={() => setShowManage(true)} className="mt-1 text-xs font-semibold text-primary underline">
          登録した振込先の管理
        </button>
      ) : null}

      {showAdd ? (
        <AddBankAccountModal
          pending={pending}
          onClose={() => setShowAdd(false)}
          onSubmit={(input) =>
            startTransition(async () => {
              await addBankAccountAction(invoiceId, input);
              setShowAdd(false);
            })
          }
        />
      ) : null}

      {showManage ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setShowManage(false)}>
          <div
            role="dialog"
            aria-label="登録した振込先"
            className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-serif-jp text-base font-bold text-primary">登録した振込先</h3>
              <button type="button" aria-label="閉じる" onClick={() => setShowManage(false)} className="text-muted">
                ✕
              </button>
            </div>
            <p className="mb-3 text-xs text-muted">削除しても、作成済み・発行済みの請求書の振込先は変わりません。</p>
            <ul className="flex flex-col gap-2">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <BankCardText fields={a} />
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => startTransition(() => deleteBankAccountAction(invoiceId, a.id))}
                    className="shrink-0 text-xs font-semibold text-red-600 disabled:opacity-60"
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// 振込先の表示：銀行／支店／種別・口座番号／名義を1行ずつ
function BankCardText({ fields, note }: { fields: BankFields; note?: string | null }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block break-words text-sm font-semibold">{fields.bankName}</span>
      {fields.branchName ? <span className="block break-words text-sm">{fields.branchName}</span> : null}
      <span className="block text-sm tabular-nums">
        {[fields.accountType, fields.accountNumber].filter(Boolean).join(" ")}
      </span>
      <span className="block break-words text-xs text-muted">名義：{fields.accountHolderName}</span>
      {note ? <span className="mt-0.5 block text-xs text-amber-700">{note}</span> : null}
    </span>
  );
}

function AddBankAccountModal({
  pending,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: BankFields) => void;
}) {
  const [form, setForm] = useState<BankFields>({
    bankName: "",
    branchName: "",
    accountType: "普通",
    accountNumber: "",
    accountHolderName: "",
  });
  const canSubmit = form.bankName.trim() && form.accountNumber.trim() && form.accountHolderName.trim();
  const field = (key: keyof BankFields, label: string, placeholder?: string) => (
    <label className="flex flex-col gap-1 text-xs">
      {label}
      <input
        type="text"
        value={form[key]}
        placeholder={placeholder}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="rounded-lg border border-border px-3 py-2 text-sm"
      />
    </label>
  );
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="振込先を追加"
        className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-serif-jp text-base font-bold text-primary">振込先を追加</h3>
          <button type="button" aria-label="閉じる" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {field("bankName", "銀行名（必須）", "例：〇〇銀行")}
          {field("branchName", "支店名", "例：〇〇支店")}
          <label className="flex flex-col gap-1 text-xs">
            口座種別
            <select
              value={form.accountType}
              onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value }))}
              className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
            >
              <option value="普通">普通</option>
              <option value="当座">当座</option>
            </select>
          </label>
          {field("accountNumber", "口座番号（必須）")}
          {field("accountHolderName", "口座名義（必須）")}
        </div>
        <button
          type="button"
          disabled={pending || !canSubmit}
          onClick={() => onSubmit(form)}
          className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          追加してこの請求書で使う
        </button>
      </div>
    </div>
  );
}
