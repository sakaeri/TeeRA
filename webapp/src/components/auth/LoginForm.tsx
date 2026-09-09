"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, type FormState } from "@/app/actions/auth";

export function LoginForm({ from, justReset }: { from?: string; justReset?: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    loginAction,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      {from ? <input type="hidden" name="from" value={from} /> : null}

      {justReset ? (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          パスワードを変更しました。新しいパスワードでログインしてください。
        </p>
      ) : null}

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

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm text-foreground/80">
          パスワード
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-primary"
        />
        {state?.errors?.password ? (
          <p className="text-xs text-red-600">{state.errors.password[0]}</p>
        ) : null}
        <Link href="/forgot-password" className="self-end text-xs text-primary underline">
          パスワードをお忘れですか？
        </Link>
      </div>

      {state?.message ? (
        <p className="text-sm text-red-600">{state.message}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? "ログイン中…" : "ログイン"}
      </button>

      <p className="mt-2 text-center text-sm text-muted">
        アカウントをお持ちでない方は{" "}
        <Link href="/register" className="text-primary underline">
          新規登録
        </Link>
      </p>
    </form>
  );
}
