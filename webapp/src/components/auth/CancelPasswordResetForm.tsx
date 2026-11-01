"use client";

import { useActionState } from "react";
import Link from "next/link";
import { cancelPasswordResetAction, type FormState } from "@/app/actions/auth";

export function CancelPasswordResetForm({ token }: { token: string }) {
  const boundAction = cancelPasswordResetAction.bind(null, token);
  const [state, action, pending] = useActionState<FormState, FormData>(boundAction, undefined);

  if (state?.message === "cancelled") {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          パスワードの再設定を取り消しました。パスワードは元のままです。
        </p>
        <p className="text-sm text-foreground/80">
          ご自身で申し込んでいない場合は、メールのパスワードも変更し、アカウント設定の「すべての端末からログアウト」も押してください。
        </p>
        <Link href="/login" className="text-center text-sm text-primary underline">
          ログイン画面へ
        </Link>
      </div>
    );
  }
  if (state?.message === "invalid_or_expired_token") {
    return (
      <p className="text-sm text-red-600">
        このリンクは無効か、すでに使われています（再設定が有効になった後は取り消せません）。
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm text-foreground/80">
        申し込み中のパスワード再設定を取り消します。取り消すと、パスワードは元のままになります。
      </p>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? "取り消し中…" : "再設定を取り消す"}
      </button>
    </form>
  );
}
