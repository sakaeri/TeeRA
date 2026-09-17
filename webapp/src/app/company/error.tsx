"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function CompanyError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <p className="font-serif-jp text-xl font-bold text-primary">エラーが発生しました</p>
      <p className="text-sm text-muted">
        一時的な問題の可能性があります。もう一度お試しください。改善しない場合は運営までお問い合わせください。
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          もう一度試す
        </button>
        <Link href="/company" className="rounded-lg border border-border px-4 py-2 text-sm text-foreground">
          ダッシュボードへ戻る
        </Link>
      </div>
    </div>
  );
}
