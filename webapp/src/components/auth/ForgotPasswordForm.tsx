"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordResetAction, type FormState } from "@/app/actions/auth";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(
    requestPasswordResetAction,
    undefined,
  );

  if (state?.message === "sent") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-foreground/80">
          ご入力いただいたメールアドレス宛にパスワード再設定のご案内を送信しました（アカウントが登録されている場合）。メールをご確認ください。
        </p>
        <Link href="/login" className="text-center text-sm text-primary underline">
          ログイン画面に戻る
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm text-foreground/80">
          メールアドレス
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-primary"
        />
        {state?.errors?.email ? (
          <p className="text-xs text-red-600">{state.errors.email[0]}</p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? "送信中…" : "再設定メールを送信する"}
      </button>

      <Link href="/login" className="text-center text-sm text-muted underline">
        ログイン画面に戻る
      </Link>
    </form>
  );
}
