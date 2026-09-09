"use client";

import { useActionState } from "react";
import { changePasswordAction, requestEmailChangeAction } from "@/app/actions/account";
import type { FormState } from "@/app/actions/auth";

function ChangePasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(
    changePasswordAction,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="currentPassword" className="text-sm text-foreground/80">
          現在のパスワード
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          className="rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-primary"
        />
        {state?.errors?.currentPassword ? (
          <p className="text-xs text-red-600">{state.errors.currentPassword[0]}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="newPassword" className="text-sm text-foreground/80">
          新しいパスワード
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          required
          autoComplete="new-password"
          className="rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-primary"
        />
        <p className="text-xs text-muted">8文字以上、英字と数字を含めてください。</p>
        {state?.errors?.newPassword ? (
          <p className="text-xs text-red-600">{state.errors.newPassword[0]}</p>
        ) : null}
      </div>

      {state?.message ? (
        <p className={`text-sm ${state.message === "パスワードを変更しました。" ? "text-green-700" : "text-red-600"}`}>
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? "変更中…" : "パスワードを変更する"}
      </button>
    </form>
  );
}

function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    requestEmailChangeAction,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm text-muted">現在のメールアドレス：{currentEmail}</p>

      <div className="flex flex-col gap-1">
        <label htmlFor="newEmail" className="text-sm text-foreground/80">
          新しいメールアドレス
        </label>
        <input
          id="newEmail"
          name="newEmail"
          type="email"
          required
          autoComplete="email"
          className="rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-primary"
        />
        {state?.errors?.newEmail ? (
          <p className="text-xs text-red-600">{state.errors.newEmail[0]}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="currentPasswordForEmail" className="text-sm text-foreground/80">
          現在のパスワード（確認のため）
        </label>
        <input
          id="currentPasswordForEmail"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          className="rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-primary"
        />
        {state?.errors?.currentPassword ? (
          <p className="text-xs text-red-600">{state.errors.currentPassword[0]}</p>
        ) : null}
      </div>

      {state?.message ? (
        <p className={`text-sm ${state.message.startsWith("確認メール") ? "text-green-700" : "text-red-600"}`}>
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? "送信中…" : "確認メールを送信する"}
      </button>
    </form>
  );
}

export function AccountView({
  userName,
  userEmail,
  emailChangeNotice,
}: {
  userName: string;
  userEmail: string;
  emailChangeNotice?: "success" | "error";
}) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="mb-1 font-serif-jp text-2xl font-bold">アカウント設定</h1>
        <p className="text-sm text-muted">{userName}さんのログイン情報を管理します。</p>
      </div>

      {emailChangeNotice === "success" ? (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          メールアドレスの変更が完了しました。
        </p>
      ) : null}
      {emailChangeNotice === "error" ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          確認リンクが無効か、有効期限が切れています。お手数ですが再度お試しください。
        </p>
      ) : null}

      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <h2 className="mb-4 font-serif-jp text-lg font-bold text-primary">パスワードを変更する</h2>
        <ChangePasswordForm />
      </section>

      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <h2 className="mb-4 font-serif-jp text-lg font-bold text-primary">メールアドレスを変更する</h2>
        <ChangeEmailForm currentEmail={userEmail} />
      </section>
    </div>
  );
}
