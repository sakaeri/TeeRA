"use client";

import { useState, type ReactNode } from "react";
import { logoutAction } from "@/app/actions/auth";

// どこの会社にも入っていない人の最初の画面。スタッフとして使う人が間違えて会社を作らないように、
// 「スタッフとして働く方はこちら」を押すと、会社を作る欄を隠して招待URLからの参加のしかたを出す。
export function StaffOrCompanyChooser({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState(false);
  if (staff) {
    return (
      <div className="rounded-2xl border border-accent/40 bg-white p-6" data-testid="staff-guide-open">
        <h1 className="mb-3 text-lg font-semibold text-primary">スタッフとして働く方</h1>
        <p className="mb-3 text-sm text-foreground/80">会社を作る必要はありません。次の順で参加してください。</p>
        <ol className="mb-4 flex list-decimal flex-col gap-2 pl-5 text-sm">
          <li>所属先の会社から届いた<span className="font-semibold">招待URL</span>（メールやLINE）を開く</li>
          <li>「すでにアカウントをお持ちの方は ログイン」の<span className="font-semibold">「ログイン」</span>を押す</li>
          <li>このメールアドレスでログインして、<span className="font-semibold">「参加する」</span>を押す</li>
        </ol>
        <p className="mb-4 rounded-lg bg-background px-3 py-2 text-xs text-muted">
          招待URLが届いていない時は、所属先の会社に「TeeRAの招待URLを送ってください」と伝えてください。
        </p>
        <form action={logoutAction}>
          <button type="submit" className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
            わかりました（いったんログアウトする）
          </button>
        </form>
        <button type="button" onClick={() => setStaff(false)} className="mt-3 w-full text-center text-xs text-muted underline">
          ← 会社として使う方はこちら
        </button>
      </div>
    );
  }
  return (
    <>
      <div className="mb-4 rounded-2xl border border-accent/40 bg-accent/10 p-5" data-testid="staff-guide">
        <h2 className="mb-1 text-base font-semibold text-primary">スタッフとして働く方</h2>
        <p className="mb-3 text-sm text-foreground/80">会社を作る必要はありません。下の欄には何も入れずに、こちらを押してください。</p>
        <button
          type="button"
          onClick={() => setStaff(true)}
          className="w-full rounded-lg border border-primary bg-white px-4 py-2.5 text-sm font-semibold text-primary"
        >
          スタッフとして働く方はこちら
        </button>
      </div>
      {children}
    </>
  );
}
