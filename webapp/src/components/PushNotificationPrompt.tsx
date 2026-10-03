"use client";

import { useEffect, useState } from "react";
import { pushSupported, subscribeToPush } from "@/lib/pushClient";

const DISMISSED_KEY = "teera-push-prompt-dismissed";

// 初回ログイン時に自動でブラウザの通知許可ダイアログへ誘導するバナー。
// account設定の手動トグル（PushNotificationToggle）とは別に、ほとんどの
// 人がわざわざ設定画面を開かなくても購読できるようにするための導線。
// 一度許可/あとでを選んだブラウザでは二度と出さない（localStorageは
// このブラウザだけの表示有無を覚える用途なので、ここで使って良い）。
export function PushNotificationPrompt() {
  const [visible, setVisible] = useState(false);
  const [working, setWorking] = useState(false);

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (!vapidPublicKey || !pushSupported()) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      // ブロックされたストレージ等 — バナーは出さない方向に倒す。
      dismissed = true;
    }
    if (dismissed) return;
    if (Notification.permission !== "default") return; // 既に許可/拒否済み

    let cancelled = false;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!cancelled && !sub) setVisible(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // ストレージが使えなくても、このセッション中は閉じたままにする。
    }
    setVisible(false);
  }

  async function allow() {
    setWorking(true);
    await subscribeToPush(vapidPublicKey!);
    setWorking(false);
    dismiss();
  }

  if (!visible) return null;

  // position:fixedだとページごとに違う位置にあるタブバーやフローティング
  // ボタンと重なってクリックを奪ってしまう事故が起きたため、ヘッダー直下に
  // 通常のドキュメントフローで差し込み、表示中は下のコンテンツを押し下げる
  // 形にしている（どのページでも絶対に何とも重ならない）。
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-accent bg-primary px-4 py-3 text-primary-foreground sm:px-6">
      <p className="text-sm">
        業務報告の提出やシフト開始前など、タイミングが重要なお知らせをプッシュ通知で受け取りますか？
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={allow}
          disabled={working}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-primary disabled:opacity-60"
        >
          {working ? "設定中…" : "許可する"}
        </button>
        <button type="button" onClick={dismiss} disabled={working} className="rounded-lg px-4 py-2 text-sm opacity-80 disabled:opacity-40">
          あとで
        </button>
      </div>
    </div>
  );
}
