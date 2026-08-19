"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerAction, type FormState } from "@/app/actions/auth";

export function RegisterForm({ inviteToken }: { inviteToken?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    registerAction,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      {inviteToken ? (
        <input type="hidden" name="inviteToken" value={inviteToken} />
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-sm text-foreground/80">
          氏名
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          className="rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-primary"
        />
        {state?.errors?.name ? (
          <p className="text-xs text-red-600">{state.errors.name[0]}</p>
        ) : null}
      </div>

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
          autoComplete="new-password"
          className="rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-primary"
        />
        <p className="text-xs text-muted">8文字以上、英字と数字を含めてください。</p>
        {state?.errors?.password ? (
          <p className="text-xs text-red-600">{state.errors.password[0]}</p>
        ) : null}
      </div>

      {state?.message ? (
        <p className="text-sm text-red-600">{state.message}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? "登録中…" : "アカウントを作成"}
      </button>

      <p className="mt-2 text-center text-sm text-muted">
        すでにアカウントをお持ちの方は{" "}
        <Link href="/login" className="text-primary underline">
          ログイン
        </Link>
      </p>
    </form>
  );
}
