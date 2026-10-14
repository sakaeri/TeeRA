"use client";

import { useState, useActionState } from "react";
import Link from "next/link";
import { loginAction, requestLoginMagicLinkAction, type FormState } from "@/app/actions/auth";

function MagicLinkRequestForm({ onBack, from }: { onBack: () => void; from?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    requestLoginMagicLinkAction,
    undefined,
  );

  if (state?.message === "sent") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-foreground/80">
          ご入力いただいたメールアドレス宛にログイン用のリンクを送信しました（アカウントが登録されている場合）。メールをご確認ください。パスワードを設定済みの方には、代わりにパスワードでのログインをご案内するメールが届きます。
        </p>
        <p className="text-xs text-muted">
          メールが届かない場合は、迷惑メールフォルダもご確認ください。
        </p>
        <button type="button" onClick={onBack} className="text-center text-sm text-primary underline">
          ログイン画面に戻る
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      {from ? <input type="hidden" name="from" value={from} /> : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="magicLinkEmail" className="text-sm text-foreground/80">
          メールアドレス
        </label>
        <input
          id="magicLinkEmail"
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
        {pending ? "送信中…" : "ログイン用リンクを送信する"}
      </button>

      <button type="button" onClick={onBack} className="text-center text-sm text-muted underline">
        パスワードでログインする
      </button>
    </form>
  );
}

export function LoginForm({ from, justReset }: { from?: string; justReset?: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    loginAction,
    undefined,
  );
  const [mode, setMode] = useState<"password" | "magic-link">("password");

  if (mode === "magic-link") {
    return <MagicLinkRequestForm onBack={() => setMode("password")} from={from} />;
  }

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

      <button
        type="button"
        onClick={() => setMode("magic-link")}
        className="text-center text-sm text-primary underline"
      >
        パスワードをお持ちでない方はこちら（メールでログイン）
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
