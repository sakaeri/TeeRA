"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

type Status = "checking" | "unsupported" | "unconfigured" | "off" | "on" | "working";

export function PushNotificationToggle() {
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      if (!vapidPublicKey) {
        if (!cancelled) setStatus("unconfigured");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setStatus(sub ? "on" : "off");
      } catch {
        if (!cancelled) setStatus("unsupported");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  async function enable() {
    setError(null);
    setStatus("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("off");
        setError("通知が許可されませんでした。ブラウザの通知設定をご確認ください。");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!),
      });
      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      if (!res.ok) throw new Error("subscribe failed");
      setStatus("on");
    } catch {
      setStatus("off");
      setError("通知の設定に失敗しました。もう一度お試しください。");
    }
  }

  async function disable() {
    setError(null);
    setStatus("working");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch {
      setStatus("on");
      setError("通知の解除に失敗しました。もう一度お試しください。");
    }
  }

  if (status === "checking") return null;
  if (status === "unsupported") {
    return <p className="text-sm text-muted">このブラウザではプッシュ通知を利用できません。</p>;
  }
  if (status === "unconfigured") {
    return <p className="text-sm text-muted">現在プッシュ通知は準備中です。</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        業務報告の提出・シフト開始前・未確定のシフト希望など、タイミングが重要なお知らせをこのブラウザにプッシュ通知で届けます（届く内容は役割によって異なります）。
      </p>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {status === "on" ? (
        <button
          type="button"
          onClick={disable}
          className="self-start rounded-lg border border-primary px-4 py-2.5 text-sm text-primary disabled:opacity-60"
        >
          プッシュ通知をオフにする
        </button>
      ) : (
        <button
          type="button"
          onClick={enable}
          disabled={status === "working"}
          className="self-start rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {status === "working" ? "設定中…" : "このブラウザでプッシュ通知を受け取る"}
        </button>
      )}
    </div>
  );
}
