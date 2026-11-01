"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestLoginMagicLinkAction, type FormState } from "@/app/actions/auth";

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

  if (state?.message === "sent") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-foreground/80">
          ご入力いただいたメールアドレス宛にログイン用のリンクを送信しました（アカウントが登録されている場合）。メールのリンクを15分以内に開いてください。パスワードを設定している方は、続けてパスワードを入力します。
        </p>
        <p className="text-xs text-muted">メールが届かない場合は、迷惑メールフォルダもご確認ください。</p>
      </div>
    );
  }

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
          className="rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-primary"
        />
        {state?.errors?.email ? <p className="text-xs text-red-600">{state.errors.email[0]}</p> : null}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? "送信中…" : "ログイン用リンクを送信する"}
      </button>

      <p className="text-xs text-muted">
        メールに届くリンクからログインします。パスワードを設定している方は、リンクを開いた後にパスワードを入力します。
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
