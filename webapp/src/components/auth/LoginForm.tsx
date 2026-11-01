"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { requestLoginMagicLinkAction, loginWithCodeAction, type FormState } from "@/app/actions/auth";

export type LoginNotice = "passwordChanged" | "loggedOutAll" | "linkError";

const NOTICE_TEXT: Record<LoginNotice, { text: string; tone: "ok" | "error" }> = {
  passwordChanged: { text: "パスワードを変更しました。すべての端末からログアウトしたので、もう一度ログインしてください。", tone: "ok" },
  loggedOutAll: { text: "すべての端末からログアウトしました。", tone: "ok" },
  linkError: { text: "ログイン用のリンクが無効か、有効期限（15分）が切れています。もう一度リンクを受け取ってください。", tone: "error" },
};

// ログインはメールに届くリンクから。パスワードを設定している人は、リンクを
// 開いた後にパスワードを入れる（2段階目）。メールアドレスとパスワードだけで
// ログインする入口は無い。
export function LoginForm({ from, notice }: { from?: string; notice?: LoginNotice }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    requestLoginMagicLinkAction,
    undefined,
  );

  const [email, setEmail] = useState("");

  if (state?.message === "sent") return <LoginCodeForm email={email} />;

  const noticeText = notice ? NOTICE_TEXT[notice] : null;

  return (
    <form action={action} className="flex flex-col gap-4">
      {from ? <input type="hidden" name="from" value={from} /> : null}

      {noticeText ? (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${noticeText.tone === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
        >
          {noticeText.text}
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
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-primary"
        />
        {state?.errors?.email ? <p className="text-xs text-red-600">{state.errors.email[0]}</p> : null}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? "送信中…" : "ログイン用のメールを送信する"}
      </button>

      <p className="text-xs text-muted">
        メールに届くコード（またはリンク）でログインします。パスワードを設定している方は、続けてパスワードを入力します。
      </p>

      <p className="mt-2 text-center text-sm text-muted">
        アカウントをお持ちでない方は{" "}
        <Link href="/register" className="text-primary underline">
          新規登録
        </Link>
      </p>
    </form>
  );
}

// メールを送った後。ホーム画面に追加したアプリではメールのリンクがブラウザで開いて
// しまうため、メールに載っている6桁のコードをここに入れてログインする。
function LoginCodeForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginWithCodeAction, undefined);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="email" value={email} />
      <p className="text-sm text-foreground/80">
        <span className="font-semibold">{email}</span> 宛にログイン用のメールを送信しました（アカウントが登録されている場合）。メールに書かれている6桁のコードを入力してください。
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor="code" className="text-sm text-foreground/80">
          ログインコード（6桁）
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          required
          autoFocus
          className="rounded-lg border border-border bg-white px-3.5 py-2.5 text-center text-2xl tracking-[0.4em] outline-none focus:border-primary"
        />
        {state?.errors?.code ? <p className="text-xs text-red-600">{state.errors.code[0]}</p> : null}
      </div>
      {state?.message ? <p className="text-sm text-red-600">{state.message}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? "確認中…" : "ログイン"}
      </button>
      <p className="text-xs text-muted">
        メールのリンクを開いてもログインできます（パソコンなど、ブラウザで使っている場合）。コード・リンクとも15分間有効です。メールが届かない場合は、迷惑メールフォルダもご確認ください。
      </p>
      <button type="button" className="text-center text-sm text-primary underline" onClick={() => location.reload()}>
        メールアドレスを入力し直す
      </button>
    </form>
  );
}
