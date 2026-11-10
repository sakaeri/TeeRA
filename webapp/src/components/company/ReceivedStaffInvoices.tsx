"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PdfLink } from "@/components/PdfLink";
import { openStaffInvoiceAction, reviewStaffInvoiceAction, updateContractorSettingsAction } from "@/app/company/payroll/actions";

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  SUBMITTED: { text: "確認待ち", className: "bg-amber-100 text-amber-800" },
  RETURNED: { text: "差し戻し中", className: "bg-red-100 text-red-800" },
  APPROVED: { text: "承認済み", className: "bg-emerald-100 text-emerald-800" },
};

export type ReceivedInvoiceRow = {
  id: string;
  staffName: string;
  status: string;
  opened: boolean;
  freeToOpen: boolean;
};

// 一覧：中身（金額）は開くまで出さない。開く時に「1件分使います」と確かめる
export function ReceivedStaffInvoiceList({
  rows,
  targetMonth,
  quota,
}: {
  rows: ReceivedInvoiceRow[];
  targetMonth: string;
  quota: { remaining: number; unlimited: boolean; quota: number };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [m] = [Number(targetMonth.slice(5, 7))];
  const [infoOpen, setInfoOpen] = useState(false);

  function open(row: ReceivedInvoiceRow) {
    setError(null);
    const href = `/company/payroll?month=${targetMonth}&staffInvoice=${row.id}`;
    if (row.opened) {
      router.push(href);
      return;
    }
    const cost = row.freeToOpen
      ? "この月の支払明細を発行済みなので、無料で開けます。"
      : quota.unlimited
        ? "開くと、今のプランの発行枠を1件使います（無制限）。"
        : quota.quota > 0 && quota.remaining > 0
          ? `開くと、${m}月分の無料枠を1件使います（残り${quota.remaining}件）。`
          : "開くと1Teeを使います（無料枠を使い切っています）。";
    if (!confirm(`${row.staffName}さんの請求書を開きます。\n${cost}\n同じ人の同じ月の分は、直して再提出されても追加はかかりません。`)) return;
    startTransition(async () => {
      const result = await openStaffInvoiceAction(row.id);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push(href);
    });
  }

  return (
    <section className="mt-10" data-testid="received-staff-invoices">
      {/* スマホでは見出しが1行に収まらないので、意味の切れ目（「業務委託のスタッフから」「届いた請求書」）で折り返す */}
      <div className="mb-3 flex items-start gap-1.5">
        <h2 className="font-serif-jp text-base font-bold leading-snug text-primary sm:text-lg">
          <span className="inline-block">業務委託のスタッフから</span>
          <span className="inline-block">届いた請求書</span>
        </h2>
        {/* 説明は「ⓘ」を押した時だけ出す（一覧の上に長い文が並ばないように） */}
        <button
          type="button"
          aria-label="説明を見る"
          aria-expanded={infoOpen}
          onClick={() => setInfoOpen((v) => !v)}
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-muted text-[11px] font-bold text-muted sm:mt-1"
        >
          i
        </button>
      </div>
      {infoOpen ? (
        <p className="-mt-1 mb-3 rounded-lg bg-background px-3 py-2 text-xs text-muted" data-testid="received-staff-invoices-info">
          承認するまでここに出て、承認すると「発行履歴」に移ります。開くと1件分（無料枠か1Tee）を使います。同じ人の同じ月は1回だけで、その月の支払明細を発行済みなら無料です。
        </p>
      ) : null}
      {error ? (
        <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}{" "}
          <Link href="/company/wallet" className="underline">
            チャージする
          </Link>
        </p>
      ) : null}
      {rows.length === 0 ? <p className="text-sm text-muted">まだ届いていません。</p> : null}
      <ul className="flex flex-col gap-1">
        {rows.map((r) => {
          const st = STATUS_LABEL[r.status];
          return (
            <li key={r.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => open(r)}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-white/60 px-4 py-2 text-left text-sm hover:bg-background disabled:opacity-60"
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">{r.staffName}</span>
                  {st ? <span className={`rounded-full px-2 py-0.5 text-xs ${st.className}`}>{st.text}</span> : null}
                  {!r.opened ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">未開封</span> : null}
                </span>
                <span className="text-xs font-semibold text-primary underline">{r.opened ? "見る" : "開く"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export type ReceivedInvoiceDetail = {
  id: string;
  staffName: string;
  targetMonth: string;
  status: string;
  submittedAt: string;
  lines: { shiftId: string; description: string; hours: number; rate: number; amount: number }[];
  expenses: { label: string; quantity: number; unitPrice: number; amount: number }[];
  note: string | null;
  issuerName: string | null;
  issuerAddress: string | null;
  registrationNumber: string | null;
  bankLine: string | null;
  withholding: boolean;
  taxExclusive: boolean;
  workSubtotal: number;
  taxAmount: number;
  withholdingAmount: number;
  expensesTotal: number;
  total: number;
  returnReason: string | null;
};

const yen = (n: number) => `${n.toLocaleString()}円`;

export function ReceivedStaffInvoiceView({ invoice }: { invoice: ReceivedInvoiceDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [returning, setReturning] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [y, m] = invoice.targetMonth.split("-").map(Number);
  const st = STATUS_LABEL[invoice.status];
  const reviewable = invoice.status === "SUBMITTED";

  function review(decision: "approve" | "return") {
    setMessage(null);
    if (decision === "approve" && !confirm(`${invoice.staffName}さんの${m}月分の請求書（${yen(invoice.total)}）を承認します。よろしいですか？`)) return;
    startTransition(async () => {
      const result = await reviewStaffInvoiceAction(invoice.id, decision, reason);
      if (!result.ok) {
        setMessage({ ok: false, text: result.message });
        return;
      }
      setMessage({ ok: true, text: decision === "approve" ? "承認しました ✓ スタッフに知らせました。" : "差し戻しました。スタッフに知らせました。" });
      setReturning(false);
      router.refresh();
    });
  }

  function changeSettings(next: { withholding: boolean; taxExclusive: boolean }) {
    startTransition(async () => {
      await updateContractorSettingsAction(invoice.id, next.withholding, next.taxExclusive);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="received-staff-invoice">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-serif-jp text-lg font-bold text-primary">
          {invoice.staffName}さんの請求書（{y}年{m}月分）
        </h2>
        {st ? <span className={`rounded-full px-2 py-0.5 text-xs ${st.className}`}>{st.text}</span> : null}
      </div>
      <p className="text-xs text-muted">提出日 {invoice.submittedAt}</p>
      {invoice.status === "RETURNED" && invoice.returnReason ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">差し戻した理由：{invoice.returnReason}（スタッフが直して再提出するのを待っています）</p>
      ) : null}

      <section className="rounded-2xl border border-border bg-white/60 p-4">
        <ul className="divide-y divide-border/60 text-sm">
          {invoice.lines.map((l) => (
            <li key={l.shiftId} className="flex justify-between gap-3 py-1.5">
              <span>
                {l.description.replace(/（日給）$/, "")}
                <span className="ml-2 text-xs text-muted">
                  {l.description.endsWith("（日給）") ? "1日" : `${l.hours}時間`} × {yen(l.rate)}
                </span>
              </span>
              <span className="shrink-0">{yen(l.amount)}</span>
            </li>
          ))}
          {invoice.expenses.map((e, i) => (
            <li key={`e${i}`} className="flex justify-between gap-3 py-1.5">
              <span>
                {e.label}
                <span className="ml-2 text-xs text-muted">
                  {e.quantity} × {yen(e.unitPrice)}（その他の項目）
                </span>
              </span>
              <span className="shrink-0">{yen(e.amount)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">報酬（{invoice.taxExclusive ? "税抜" : "税込"}）</dt>
            <dd>{yen(invoice.workSubtotal)}</dd>
          </div>
          {invoice.taxExclusive ? (
            <div className="flex justify-between">
              <dt className="text-muted">消費税（10%）</dt>
              <dd>{yen(invoice.taxAmount)}</dd>
            </div>
          ) : null}
          {invoice.withholding ? (
            <div className="flex justify-between">
              <dt className="text-muted">源泉徴収税</dt>
              <dd>−{yen(invoice.withholdingAmount)}</dd>
            </div>
          ) : null}
          {invoice.expensesTotal > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted">その他の項目</dt>
              <dd>{yen(invoice.expensesTotal)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between text-base font-bold text-primary">
            <dt>請求金額（振り込む金額）</dt>
            <dd data-testid="received-invoice-total">{yen(invoice.total)}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-2xl border border-border bg-white/60 p-4 text-sm">
        <p className="mb-1">
          <span className="text-muted">請求者：</span>
          {invoice.issuerName}
          {invoice.issuerAddress ? `（${invoice.issuerAddress}）` : ""}
        </p>
        <p className="mb-1">
          <span className="text-muted">登録番号：</span>
          {invoice.registrationNumber ?? "なし"}
        </p>
        <p className="mb-1">
          <span className="text-muted">振込先：</span>
          {invoice.bankLine ?? "未登録"}
        </p>
        {invoice.note ? (
          <p className="whitespace-pre-wrap">
            <span className="text-muted">備考：</span>
            {invoice.note}
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border bg-white/60 p-4 text-sm">
        <h3 className="mb-2 font-semibold text-primary">この人の請求書の扱い（会社が決めます）</h3>
        <label className="mb-1.5 flex items-center gap-2">
          <input
            type="checkbox"
            checked={invoice.withholding}
            disabled={pending || invoice.status === "APPROVED"}
            onChange={(e) => changeSettings({ withholding: e.target.checked, taxExclusive: invoice.taxExclusive })}
          />
          源泉徴収する（報酬の10.21%、100万円を超える部分は20.42%）
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={invoice.taxExclusive}
            disabled={pending || invoice.status === "APPROVED"}
            onChange={(e) => changeSettings({ withholding: invoice.withholding, taxExclusive: e.target.checked })}
          />
          報酬に消費税（10%）を上乗せする（外すと、報酬は税込とみなします）
        </label>
        <p className="mt-2 text-xs text-muted">
          変えると、確認待ちの請求書の金額も計算し直し、次からの請求書にも使います。「その他の項目」（交通費など）は実費の精算として、消費税・源泉徴収をかけずに計算しています。どの報酬が源泉徴収の対象になるかは、税理士などに確認してください。
        </p>
      </section>

      {message ? (
        <p className={`rounded-lg px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>{message.text}</p>
      ) : null}

      {reviewable ? (
        returning ? (
          <div className="flex flex-col gap-2">
            <textarea
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
              rows={3}
              placeholder="差し戻す理由（例：10/5の交通費の金額を確認してください）"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setReturning(false)} className="rounded-lg border border-border px-4 py-2 text-sm">
                やめる
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => review("return")}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                差し戻す
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setReturning(true)}
              className="rounded-lg border border-red-700 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-60"
            >
              差し戻す
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => review("approve")}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              承認する
            </button>
          </div>
        )
      ) : null}

      <PdfLink href={`/api/staff-invoices/${invoice.id}/pdf`} className="text-sm font-semibold text-primary underline">
        請求書のPDFを見る
      </PdfLink>
    </div>
  );
}
