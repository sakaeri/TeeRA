"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getTransferFeeReviewAction, setTransferCancellationFeeAction } from "@/app/company/calendar/actions";

const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];
function formatDateJa(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00Z");
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEKDAYS_JA[d.getUTCDay()]}）`;
}

// 振替（スタッフが業務報告で別の現場に変えた）と、スタッフが報告した「勤務先キャンセル」の時の、
// 依頼主へのキャンセル料を決める。ダッシュボードのやること・業務報告の詳細から開く。
// 何が起きたか・何をすればいいか・依頼主のキャンセル規定（あれば規定から出る金額を入れておく）をまとめて出す
export function CancellationFeeModal({
  shiftId,
  onClose,
  onSaved,
}: {
  shiftId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getTransferFeeReviewAction>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fee, setFee] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getTransferFeeReviewAction(shiftId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        // 決めた後に開き直した時は今の金額、まだなら規定から出る金額を入れておく
        if (!d.feeReviewPending) setFee(String(d.currentFee));
        else if (d.suggestedFee) setFee(String(d.suggestedFee));
      })
      .catch(() => {
        if (!cancelled) setError("読み込めませんでした。");
      });
    return () => {
      cancelled = true;
    };
  }, [shiftId]);

  function save(amount: number) {
    startTransition(async () => {
      await setTransferCancellationFeeAction(shiftId, amount);
      onClose();
      onSaved?.();
      router.refresh();
    });
  }

  const dateLabel = detail ? formatDateJa(detail.date) : "";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="キャンセル料の確認"
        className="max-h-popup w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">キャンセル料の確認</h3>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-muted hover:text-primary">
            ✕
          </button>
        </div>
        {error ? (
          <p className="py-6 text-center text-sm text-red-600">{error}</p>
        ) : !detail ? (
          <p className="py-6 text-center text-sm text-muted">読み込み中…</p>
        ) : (
          <div className="flex flex-col gap-3 text-sm" data-testid="transfer-fee-modal">
            {detail.kind === "transfer" ? (
              <p>
                <span className="font-semibold">{detail.staffName}</span>さんが、{dateLabel}の
                <span className="font-semibold">{detail.clientName}</span>
                {detail.taskName ? `（${detail.taskName}）` : ""}を、
                {detail.movedTo ? <span className="font-semibold">{detail.movedTo}</span> : "別の現場"}
                に振り替えました。
              </p>
            ) : (
              <p>
                <span className="font-semibold">{detail.staffName}</span>さんから、{dateLabel}の
                <span className="font-semibold">{detail.clientName}</span>
                {detail.taskName ? `（${detail.taskName}）` : ""}は勤務先のキャンセルで休みになったと報告がありました。
              </p>
            )}
            {!detail.feeReviewPending ? (
              <p className="text-xs text-muted">今の記録：{detail.currentFee > 0 ? `${detail.currentFee.toLocaleString()}円` : "キャンセル料なし"}</p>
            ) : null}
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
              {detail.clientName}へのキャンセル料を決めてください。決めた金額は{detail.clientName}への請求書に載ります。
            </p>
            <div className="rounded-lg bg-background px-3 py-2 text-xs">
              <p className="text-muted">{detail.clientName}のキャンセル規定</p>
              <p className="mt-0.5">{detail.ruleLabel ?? "登録されていません"}</p>
              {detail.suggestedFee ? (
                <p className="mt-1 text-muted">規定から出るキャンセル料：{detail.suggestedFee.toLocaleString()}円（下に入れてあります）</p>
              ) : null}
            </div>
            <label className="flex items-center gap-2">
              <span className="shrink-0 text-xs text-muted">キャンセル料</span>
              <input
                inputMode="numeric"
                value={fee}
                onChange={(e) => setFee(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="0"
                className="w-32 rounded-lg border border-border px-2 py-2 text-right"
                data-testid="transfer-fee-input"
              />
              <span>円</span>
            </label>
            <button
              type="button"
              disabled={pending || !fee || Number(fee) <= 0}
              onClick={() => save(Number(fee))}
              className="w-full rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground disabled:opacity-50"
            >
              この金額で記録する
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => save(0)}
              className="w-full rounded-lg border border-border px-4 py-2 text-foreground/80 disabled:opacity-50"
            >
              キャンセル料なし
            </button>
            <Link href={`/company/calendar?date=${detail.date}`} className="text-center text-xs text-muted underline">
              カレンダーでこの日を見る
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
