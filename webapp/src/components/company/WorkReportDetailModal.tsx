"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getWorkReportDetailAction } from "@/app/company/actions";
import {
  approveWorkReportAction,
  issuedDocumentsForReportAction,
  rejectWorkReportAction,
  revokeWorkReportApprovalAction,
} from "@/app/company/workreports/actions";
import { WorkReportCorrectionForm } from "@/components/company/WorkReportCorrectionForm";
import { CancellationFeeModal } from "@/components/company/CancellationFeeModal";
import { CompanyReportEntryForm } from "@/components/company/CompanyReportEntry";

type WorkReportDetail = Awaited<ReturnType<typeof getWorkReportDetailAction>>;

const OUTCOME_LABEL: Record<string, string> = {
  WORKED: "出勤",
  ABSENT: "欠勤",
  CANCELLED_BY_EMPLOYER: "勤務先キャンセル",
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: "未承認",
  APPROVED: "承認済み",
  REJECTED: "差戻し",
  NEEDS_CONFIRMATION: "スタッフの確認待ち",
};
const STATUS_PILL: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-sky-100 text-sky-800",
  REJECTED: "bg-rose-100 text-rose-800",
  NEEDS_CONFIRMATION: "bg-accent/20 text-accent",
};

function minutesLabel(minutes: number) {
  return `${Math.floor(minutes / 60)}時間${String(minutes % 60).padStart(2, "0")}分`;
}

// スタッフ詳細の稼働履歴・カレンダーの日別詳細から開く業務報告の詳細。
// 差し戻した後も理由や経緯を確認できるようにする。
// 未承認なら、ここから承認・差し戻し・時間の修正もできる（「締め日にまとめて承認」の依頼主の分も先に承認できる）。
export function WorkReportDetailModal({
  shiftId,
  onClose,
  onChanged,
}: {
  shiftId: string;
  onClose: () => void;
  // 承認などで内容が変わった時（親の一覧を読み直す）
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<WorkReportDetail | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // スタッフが出していない勤務を、会社が代わりに入力している時
  const [entering, setEntering] = useState(false);
  // 勤務先キャンセルのキャンセル料を確認・変えるポップアップ
  const [feeOpen, setFeeOpen] = useState(false);
  // 承認の取り消し：確認（その報告が入っている発行済みの書類）→ 取り消し
  const [revokeDocs, setRevokeDocs] = useState<string[] | null>(null);
  const [revokeMessage, setRevokeMessage] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // 承認待ちの操作：choose＝ボタン3つ / reject＝差し戻しの理由 / correct＝時間・勤務先を直す
  const [mode, setMode] = useState<"choose" | "reject" | "correct">("choose");
  const [rejectionReason, setRejectionReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  function afterChange(message: string) {
    setDoneMessage(message);
    setMode("choose");
    setReloadKey((k) => k + 1);
    onChanged?.();
    router.refresh();
  }
  function approve() {
    if (!detail?.workReportId) return;
    const id = detail.workReportId;
    setActionError(null);
    startTransition(async () => {
      const result = await approveWorkReportAction(id);
      if (result.status === "error") {
        setActionError(result.reason);
        return;
      }
      afterChange("承認しました。");
    });
  }
  function reject() {
    if (!detail?.workReportId || !rejectionReason.trim()) return;
    const id = detail.workReportId;
    setActionError(null);
    startTransition(async () => {
      const result = await rejectWorkReportAction(id, rejectionReason.trim());
      if (result.status === "error") {
        setActionError(result.reason);
        return;
      }
      setRejectionReason("");
      afterChange("スタッフに戻しました。");
    });
  }

  useEffect(() => {
    let cancelled = false;
    getWorkReportDetailAction(shiftId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [shiftId, reloadKey]);

  function openRevoke() {
    if (!detail?.workReportId) return;
    const id = detail.workReportId;
    setRevokeError(null);
    startTransition(async () => {
      setRevokeDocs(await issuedDocumentsForReportAction(id));
    });
  }
  function confirmRevoke() {
    if (!detail?.workReportId) return;
    const id = detail.workReportId;
    startTransition(async () => {
      const result = await revokeWorkReportApprovalAction(id);
      if (result.status === "error") {
        setRevokeError(result.reason);
        return;
      }
      setRevokeDocs(null);
      setRevokeMessage("承認前に戻しました。下のボタンから直して、承認し直してください。");
      setDoneMessage(null);
      setReloadKey((k) => k + 1);
      onChanged?.();
      router.refresh();
    });
  }

  return (
    // 親（スタッフ詳細パネル・日別詳細）の「外側クリックで閉じる」まで
    // クリックが伝わらないよう、ここで止める
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="業務報告の詳細"
        className="max-h-popup w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">業務報告の詳細</h3>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-muted hover:text-primary">
            ✕
          </button>
        </div>

        {error ? (
          <p className="py-6 text-center text-sm text-red-600">読み込めませんでした。</p>
        ) : !detail ? (
          <p className="py-6 text-center text-sm text-muted">読み込み中…</p>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <div>
              <p className="font-semibold">
                {detail.date.slice(5).replace("-", "/")}　{detail.staffName}
              </p>
              <p className="text-xs text-muted">
                {detail.workplaceLabel}
                {detail.taskName ? `・${detail.taskName}` : ""}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {detail.submitted ? (
                <>
                  <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">
                    {OUTCOME_LABEL[detail.outcome!] ?? detail.outcome}
                  </span>
                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ${STATUS_PILL[detail.approvalStatus!] ?? ""}`}>
                    {STATUS_LABEL[detail.approvalStatus!] ?? detail.approvalStatus}
                  </span>
                </>
              ) : (
                <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">未提出</span>
              )}
            </div>

            {/* 操作の結果は上に出す（下に出すと、直す欄の下に埋もれて見えない） */}
            {doneMessage ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900" data-testid="report-action-done">
                {doneMessage}
              </p>
            ) : null}

            {revokeMessage ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900" data-testid="revoke-done">
                {revokeMessage}
              </p>
            ) : null}

            {/* 直している間は、入力欄と同じ内容の表示と経緯を隠して（直す理由になるスタッフのコメントは残す）縦に伸びすぎないようにする */}
            {mode === "correct" || detail.outcome === "ABSENT" || detail.outcome === "CANCELLED_BY_EMPLOYER" ? null : (
              <dl className="grid grid-cols-[80px_1fr] gap-y-1.5 rounded-xl bg-background px-3 py-2.5 text-xs">
                <dt className="text-muted">出勤〜退勤</dt>
                <dd>{detail.clockIn || detail.clockOut ? `${detail.clockIn ?? "--:--"}〜${detail.clockOut ?? "--:--"}` : "打刻なし"}</dd>
                {detail.submitted ? (
                  <>
                    <dt className="text-muted">休憩</dt>
                    <dd>{detail.breakMinutes}分</dd>
                    <dt className="text-muted">実働</dt>
                    <dd>{minutesLabel(detail.computedMinutes)}</dd>
                  </>
                ) : null}
              </dl>
            )}

            {!detail.submitted ? (
              <p className="text-xs text-muted">スタッフがまだ業務報告を提出していません。</p>
            ) : null}
            {/* 出していない勤務は、会社が代わりに入力できる（入力と同時に承認済み） */}
            {detail.canCompanyEnter && detail.ownShift ? (
              entering ? (
                <CompanyReportEntryForm
                  shiftId={shiftId}
                  staffIsProxy={detail.staffIsProxy}
                  onDone={(message) => {
                    setEntering(false);
                    setDoneMessage(message);
                    setReloadKey((k) => k + 1);
                    onChanged?.();
                    router.refresh();
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEntering(true)}
                  className="w-full rounded-lg border border-primary px-4 py-2.5 text-sm font-semibold text-primary"
                  data-testid="company-enter-report"
                >
                  会社が代わりに入力する
                </button>
              )
            ) : null}

            {detail.comment ? (
              <div>
                <p className="mb-1 text-xs text-muted">スタッフのコメント</p>
                <p className="whitespace-pre-wrap break-words rounded-xl bg-background px-3 py-2 text-xs">{detail.comment}</p>
              </div>
            ) : null}

            {/* 勤務先キャンセル：依頼主へのキャンセル料（承認した時に規定から入れた金額。ここから変えられる） */}
            {detail.cancellationFee ? (
              <div
                className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs ${
                  detail.cancellationFee.pending ? "bg-amber-50 text-amber-900" : "bg-background"
                }`}
                data-testid="report-cancellation-fee"
              >
                <span>
                  {detail.workplaceLabel}へのキャンセル料：
                  <span className="font-semibold">
                    {detail.cancellationFee.amount > 0 ? `${detail.cancellationFee.amount.toLocaleString()}円` : "なし"}
                  </span>
                  {detail.cancellationFee.pending ? "（確認待ち）" : ""}
                </span>
                <button
                  type="button"
                  onClick={() => setFeeOpen(true)}
                  className="shrink-0 rounded-md border border-primary/40 bg-white px-2.5 py-1 font-semibold text-primary"
                >
                  {detail.cancellationFee.pending ? "確認する" : "変える"}
                </button>
              </div>
            ) : null}
            {feeOpen ? (
              <CancellationFeeModal
                shiftId={shiftId}
                onClose={() => setFeeOpen(false)}
                onSaved={() => {
                  setReloadKey((k) => k + 1);
                  onChanged?.();
                }}
              />
            ) : null}

            {detail.timeline.length > 0 && mode !== "correct" ? (
              <div>
                <p className="mb-1 text-xs text-muted">経緯</p>
                <ul className="flex flex-col gap-2">
                  {detail.timeline.map((t, i) => (
                    <li key={i} className="text-xs">
                      <span className="font-semibold">{t.label}</span>
                      <span className="ml-2 text-muted">
                        {t.at ?? ""}
                        {t.by ? `　${t.by}` : ""}
                      </span>
                      {t.note ? (
                        <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-rose-50 px-2.5 py-1.5 text-rose-900">
                          理由：{t.note}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* 承認待ち：ここから承認・差し戻し・時間の修正ができる */}
            {detail.approvalStatus === "PENDING" && detail.workReportId ? (
              <div className="flex flex-col gap-2" data-testid="report-approve-actions">
                {actionError ? <p className="text-xs text-red-600">{actionError}</p> : null}
                {mode === "correct" ? (
                  <>
                    <WorkReportCorrectionForm
                      workReportId={detail.workReportId}
                      initialClockIn={detail.clockIn}
                      initialClockOut={detail.clockOut}
                      initialBreakMinutes={detail.breakMinutes}
                      initialTaskName={detail.taskName}
                      onDone={() => afterChange("直した内容をスタッフに確認してもらいます。")}
                      workplaceOptions={detail.workplaceOptions}
                      currentRelationshipId={detail.companyRelationshipId}
                      workplaceLocked={detail.workplaceLocked}
                    />
                    <button type="button" onClick={() => setMode("choose")} className="w-full py-1.5 text-xs text-muted underline">
                      戻る
                    </button>
                  </>
                ) : mode === "reject" ? (
                  <>
                    <label className="flex flex-col gap-0.5 text-xs">
                      <span className="text-muted">直してほしい内容（スタッフに表示されます。スタッフが自分で直して再提出します）</span>
                      <textarea
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        placeholder="例：業務内容を具体的に記入してください"
                        className="rounded-lg border border-border px-3 py-2 text-sm text-foreground"
                        rows={3}
                      />
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setMode("choose")}
                        className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-foreground/70"
                      >
                        戻る
                      </button>
                      <button
                        type="button"
                        disabled={pending || !rejectionReason.trim()}
                        onClick={reject}
                        className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                      >
                        スタッフに戻す
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={approve}
                      className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      承認する
                    </button>
                    <div className={`grid gap-2 ${detail.outcome === "WORKED" ? "grid-cols-2" : "grid-cols-1"}`}>
                      {detail.outcome === "WORKED" ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => setMode("correct")}
                          className="rounded-lg border border-primary px-2 py-2.5 text-xs font-semibold text-primary disabled:opacity-60"
                        >
                          時間・勤務先を直す
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => setMode("reject")}
                        className="rounded-lg border border-border px-2 py-2.5 text-xs font-semibold text-foreground/70 disabled:opacity-60"
                      >
                        スタッフに直してもらう
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {/* 承認した後に間違いに気づいた時：報告を消さずに承認前に戻して、直して承認し直す */}
            {detail.approvalStatus === "APPROVED" && detail.workReportId ? (
              revokeDocs ? (
                <div className="flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
                  <p className="font-semibold">承認を取り消しますか？</p>
                  <p>承認前に戻るので、「時間・勤務先を直す」「スタッフに直してもらう」で直して承認し直せます。報告は消えません。</p>
                  {revokeDocs.length > 0 ? (
                    <div data-testid="revoke-issued-docs">
                      <p className="font-semibold">この報告は次の書類に入っています。直して承認し直したあと、作り直してください。</p>
                      <ul className="mt-1 list-disc pl-4">
                        {revokeDocs.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {revokeError ? <p className="text-red-700">{revokeError}</p> : null}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setRevokeDocs(null)}
                      className="flex-1 rounded-lg border border-border bg-white px-3 py-2 text-xs text-foreground"
                    >
                      やめる
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={confirmRevoke}
                      className="flex-1 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      承認を取り消す
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={openRevoke}
                  className="self-start text-xs text-rose-700 underline disabled:opacity-60"
                  data-testid="revoke-approval"
                >
                  承認を取り消して直す
                </button>
              )
            ) : null}

            {detail.previousRejectionReason ? (
              <p className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs text-muted">
                前回の差戻し理由：{detail.previousRejectionReason}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
