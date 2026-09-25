"use client";

import { useState, useTransition } from "react";
import { approveWorkReportByTokenAction } from "@/app/email-actions/approve-work-report/actions";

const ERROR_LABEL: Record<string, string> = {
  invalid_or_expired_token: "リンクが無効か、期限切れです。",
  not_pending: "この業務報告は既に処理済みです。",
  unknown: "承認に失敗しました。時間をおいて再度お試しください。",
};

export function ApproveWorkReportButton({ token, label = "承認する" }: { token: string; label?: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<"ok" | string | null>(null);

  if (result === "ok") {
    return <p className="text-center text-sm font-semibold text-primary">{label.replace(/する$/, "しました")}。</p>;
  }
  if (result) {
    return <p className="text-center text-sm text-red-600">{ERROR_LABEL[result] ?? ERROR_LABEL.unknown}</p>;
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await approveWorkReportByTokenAction(token);
          setResult(res.status === "ok" ? "ok" : res.reason);
        })
      }
      className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
    >
      {pending ? `${label.replace(/する$/, "しています")}…` : label}
    </button>
  );
}
