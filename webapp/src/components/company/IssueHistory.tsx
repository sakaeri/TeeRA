"use client";

import { useState, useTransition } from "react";
import { PdfLink } from "@/components/PdfLink";
import { hideSalarySlipIssueAction } from "@/app/company/payroll/actions";
import { hideInvoiceIssueAction } from "@/app/company/invoices/actions";

type Issue = { id: string; issuedAt: string; hidden?: boolean };

function dateLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
}

// 給料明細・請求書の発行履歴。最新の発行分だけを出し、前に出したものはたたんでおく（1件ずつ消せる。最新は消せない）。
// 消しても画面に出さないだけで、無料枠・Teeの数え方に使う記録は残す。
export function IssueHistory({ kind, docId, issues }: { kind: "salary" | "invoice"; docId: string; issues: Issue[] }) {
  const pdfBase = kind === "salary" ? `/api/salary-slips/${docId}/pdf` : `/api/invoices/${docId}/pdf`;
  const hide = kind === "salary" ? hideSalarySlipIssueAction : hideInvoiceIssueAction;
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  // issues は発行日時の新しい順
  const [latest, ...older] = issues;
  const visibleOlder = older.filter((i) => !i.hidden && !hiddenIds.includes(i.id));
  if (!latest) return null;

  return (
    <div className="mt-6" data-testid="slip-issue-history">
      <p className="mb-1.5 text-xs text-muted">発行履歴</p>
      <PdfLink href={`${pdfBase}?issueId=${latest.id}`} className="text-sm font-semibold text-primary underline">
        PDF（{dateLabel(latest.issuedAt)}発行）
      </PdfLink>
      {visibleOlder.length > 0 ? (
        <div className="mt-2">
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-muted underline">
            {open ? "▲ 過去の発行を閉じる" : `▼ 過去の発行（${visibleOlder.length}件）`}
          </button>
          {open ? (
            <ul className="mt-1 flex flex-col gap-1 text-xs">
              {visibleOlder.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 rounded-md bg-background px-3 py-1.5">
                  <PdfLink href={`${pdfBase}?issueId=${i.id}`} className="text-muted underline">
                    PDF（{dateLabel(i.issuedAt)}発行）
                  </PdfLink>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (!confirm("この発行分を履歴から削除します。よろしいですか？")) return;
                      startTransition(async () => {
                        await hide(docId, i.id);
                        setHiddenIds((ids) => [...ids, i.id]);
                      });
                    }}
                    className="text-muted hover:text-red-600 disabled:opacity-60"
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
