"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerAction, type FormState } from "@/app/actions/auth";

export function RegisterForm({ inviteToken }: { inviteToken?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    registerAction,
    undefined,
  );

  if (state?.message === "sent") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-foreground/80">
          ご入力いただいたメールアドレス宛に、登録を完了するための確認メールを送信しました。メール内のリンクをクリックして登録を完了してください（リンクは24時間有効です）。
        </p>
        <p className="text-xs text-muted">
          メールが届かない場合は、迷惑メールフォルダもご確認ください。
        </p>
        <Link href="/login" className="text-center text-sm text-primary underline">
          ログイン画面に戻る
        </Link>
      </div>
    );
  }

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
        <p className="text-xs text-muted">このメールアドレス宛に確認メールを送信します。</p>
        {state?.errors?.email ? (
          <p className="text-xs text-red-600">{state.errors.email[0]}</p>
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
        {pending ? "送信中…" : "確認メールを送信する"}
      </button>

      <p className="mt-2 text-center text-sm text-muted">
        すでにアカウントをお持ちの方は{" "}
        <Link
          href={inviteToken ? `/login?from=/invite/${inviteToken}` : "/login"}
          className="text-primary underline"
        >
          ログイン
        </Link>
      </p>
    </form>
  );
}
