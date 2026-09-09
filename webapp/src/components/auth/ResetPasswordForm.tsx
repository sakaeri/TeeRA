"use client";

import { useActionState } from "react";
import Link from "next/link";
import { resetPasswordAction, type FormState } from "@/app/actions/auth";

export function ResetPasswordForm({ token }: { token: string }) {
  const boundAction = resetPasswordAction.bind(null, token);
  const [state, action, pending] = useActionState<FormState, FormData>(
    boundAction,
    undefined,
  );

  if (state?.message === "invalid_or_expired_token") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-red-600">
          このリンクは無効か、有効期限が切れています。お手数ですが再度パスワード再設定をお試しください。
        </p>
        <Link href="/forgot-password" className="text-center text-sm text-primary underline">
          パスワード再設定をやり直す
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm text-foreground/80">
          新しいパスワード
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

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? "変更中…" : "パスワードを変更する"}
      </button>
    </form>
  );
}
