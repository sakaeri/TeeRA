"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginPasswordStepAction, type FormState } from "@/app/actions/auth";

// メールのリンクを開いた後の2段階目（パスワードを設定している人だけ）
export function PasswordStepForm({ token }: { token: string }) {
  const boundAction = loginPasswordStepAction.bind(null, token);
  const [state, action, pending] = useActionState<FormState, FormData>(boundAction, undefined);

  if (state?.message === "expired") return <PasswordStepExpired />;

  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm text-foreground/80">メールのリンクを確認しました。続けてパスワードを入力してください。</p>
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm text-foreground/80">
          パスワード
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          className="rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-primary"
        />
        {state?.errors?.password ? <p className="text-xs text-red-600">{state.errors.password[0]}</p> : null}
        <Link href="/forgot-password" className="self-end text-xs text-primary underline">
          パスワードをお忘れですか？
        </Link>
      </div>

      {state?.message ? <p className="text-sm text-red-600">{state.message}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? "ログイン中…" : "ログイン"}
      </button>
    </form>
  );
}

export function PasswordStepExpired() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-red-600">
        このページの有効期限（10分）が切れたか、すでに使われています。お手数ですが、ログイン画面からもう一度リンクを受け取ってください。
      </p>
      <Link href="/login" className="text-center text-sm text-primary underline">
        ログイン画面へ
      </Link>
    </div>
  );
}
