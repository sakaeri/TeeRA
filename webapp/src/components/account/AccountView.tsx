"use client";

import { useState, useEffect, useActionState } from "react";
import {
  changePasswordAction,
  requestEmailChangeAction,
  setInitialPasswordAction,
  removePasswordAction,
} from "@/app/actions/account";
import type { FormState } from "@/app/actions/auth";
import { PushNotificationToggle } from "@/components/account/PushNotificationToggle";

function ChangePasswordForm({ onRemoved }: { onRemoved: () => void }) {
  const [changeState, changeAction, changePending] = useActionState<FormState, FormData>(
    changePasswordAction,
    undefined,
  );
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeState, removeAction, removePending] = useActionState<FormState, FormData>(
    removePasswordAction,
    undefined,
  );

  useEffect(() => {
    if (removeState?.message === "パスワードを削除しました。次回からはメールのログイン用リンクでログインできます。") {
      onRemoved();
    }
  }, [removeState, onRemoved]);

  return (
    <div className="flex flex-col gap-5">
      <form action={changeAction} className="flex flex-col gap-4">
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
          {changeState?.errors?.currentPassword ? (
            <p className="text-xs text-red-600">{changeState.errors.currentPassword[0]}</p>
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
          {changeState?.errors?.newPassword ? (
            <p className="text-xs text-red-600">{changeState.errors.newPassword[0]}</p>
          ) : null}
        </div>

        {changeState?.message ? (
          <p className={`text-sm ${changeState.message === "パスワードを変更しました。" ? "text-green-700" : "text-red-600"}`}>
            {changeState.message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={changePending}
          className="self-start rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {changePending ? "変更中…" : "パスワードを変更する"}
        </button>
      </form>

      <div className="border-t border-border pt-4">
        {removeOpen ? (
          <form action={removeAction} className="flex flex-col gap-3">
            <p className="text-xs text-muted">
              パスワードを削除すると、以後はログイン画面の「メールでログイン」からマジックリンクでのみログインできます。アカウントの安全性はメールの受信箱の管理状況に依存します。
            </p>
            <div className="flex flex-col gap-1">
              <label htmlFor="currentPasswordForRemove" className="text-sm text-foreground/80">
                現在のパスワード（確認のため）
              </label>
              <input
                id="currentPasswordForRemove"
                name="currentPassword"
                type="password"
                required
                autoComplete="current-password"
                className="rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-primary"
              />
              {removeState?.errors?.currentPassword ? (
                <p className="text-xs text-red-600">{removeState.errors.currentPassword[0]}</p>
              ) : null}
            </div>
            {removeState?.message ? (
              <p className={`text-sm ${removeState.message.startsWith("パスワードを削除") ? "text-green-700" : "text-red-600"}`}>
                {removeState.message}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={removePending}
                className="rounded-lg bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 disabled:opacity-60"
              >
                {removePending ? "削除中…" : "パスワードを削除する"}
              </button>
              <button
                type="button"
                onClick={() => setRemoveOpen(false)}
                className="rounded-lg px-4 py-2.5 text-sm text-muted"
              >
                キャンセル
              </button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setRemoveOpen(true)} className="text-sm text-muted underline">
            パスワードを削除してマジックリンクのみに戻す
          </button>
        )}
      </div>
    </div>
  );
}

function SetPasswordForm({ onSet }: { onSet: () => void }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    setInitialPasswordAction,
    undefined,
  );

  useEffect(() => {
    if (state?.message === "パスワードを設定しました。") {
      onSet();
    }
  }, [state, onSet]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-xs text-muted">
        現在はメールのログイン用リンクのみでログインできます。パスワードを設定すると、以後はメールアドレスとパスワードでログインできるようになります（削除していつでもマジックリンクのみの状態に戻せます）。
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor="newPassword" className="text-sm text-foreground/80">
          パスワード
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

      {state?.message && state.message !== "パスワードを設定しました。" ? (
        <p className="text-sm text-red-600">{state.message}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? "設定中…" : "パスワードを設定する"}
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
  hasPassword,
  emailChangeNotice,
}: {
  userName: string;
  userEmail: string;
  hasPassword: boolean;
  emailChangeNotice?: "success" | "error";
}) {
  const [hasPasswordState, setHasPasswordState] = useState(hasPassword);
  // パスワードの設定/削除は、成功直後にこのセクションのフォーム自体が
  // 別のフォームへ差し替わる（設定する→変更する、など）。切り替わった後も
  // 「成功した」ことが分かるよう、差し替わる側のフォーム内ではなく親で
  // 一時的なバナーとして出す（emailChangeNoticeと同じ見せ方）。
  const [passwordNotice, setPasswordNotice] = useState<"set" | "removed" | null>(null);

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
      {passwordNotice === "set" ? (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">パスワードを設定しました。</p>
      ) : null}
      {passwordNotice === "removed" ? (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          パスワードを削除しました。次回からはメールのログイン用リンクでログインできます。
        </p>
      ) : null}

      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <PushNotificationToggle />
      </section>

      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <h2 className="mb-4 font-serif-jp text-lg font-bold text-primary">
          {hasPasswordState ? "パスワードを変更する" : "パスワードを設定する"}
        </h2>
        {hasPasswordState ? (
          <ChangePasswordForm
            onRemoved={() => {
              setHasPasswordState(false);
              setPasswordNotice("removed");
            }}
          />
        ) : (
          <SetPasswordForm
            onSet={() => {
              setHasPasswordState(true);
              setPasswordNotice("set");
            }}
          />
        )}
      </section>

      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <h2 className="mb-4 font-serif-jp text-lg font-bold text-primary">メールアドレスを変更する</h2>
        {hasPasswordState ? (
          <ChangeEmailForm currentEmail={userEmail} />
        ) : (
          <p className="text-sm text-muted">
            メールアドレスを変更するには、先にパスワードを設定してください。
          </p>
        )}
      </section>
    </div>
  );
}
