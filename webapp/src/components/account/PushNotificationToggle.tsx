"use client";

import { useEffect, useState } from "react";
import { pushSupported, subscribeToPush, unsubscribeFromPush, getExistingSubscription } from "@/lib/pushClient";
import { useClickOutside } from "@/lib/useClickOutside";

type Status = "checking" | "unsupported" | "unconfigured" | "off" | "on" | "working";

function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label="説明を表示"
        onClick={() => setOpen((v) => !v)}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-muted text-xs text-muted hover:border-primary hover:text-primary"
      >
        i
      </button>
      {open ? (
        <div className="absolute left-0 top-7 z-10 w-64 rounded-lg border border-border bg-white p-3 text-xs leading-relaxed text-foreground shadow-lg">
          {text}
        </div>
      ) : null}
    </div>
  );
}

function Switch({ on, disabled, onToggle }: { on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60 ${on ? "bg-primary" : "bg-border"}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}

export function PushNotificationToggle() {
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (!pushSupported()) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      if (!vapidPublicKey) {
        if (!cancelled) setStatus("unconfigured");
        return;
      }
      try {
        const sub = await getExistingSubscription();
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
    const result = await subscribeToPush(vapidPublicKey!);
    if (result.ok) {
      setStatus("on");
      return;
    }
    setStatus("off");
    setError(
      result.reason === "denied"
        ? "通知が許可されませんでした。ブラウザの通知設定をご確認ください。"
        : "通知の設定に失敗しました。もう一度お試しください。",
    );
  }

  async function disable() {
    setError(null);
    setStatus("working");
    const ok = await unsubscribeFromPush();
    if (ok) {
      setStatus("off");
    } else {
      setStatus("on");
      setError("通知の解除に失敗しました。もう一度お試しください。");
    }
  }

  if (status === "checking") return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h2 className="font-serif-jp text-lg font-bold text-primary">プッシュ通知</h2>
          <InfoTooltip text="業務報告の提出・シフト開始前・未確定のシフト希望など、タイミングが重要なお知らせをこのブラウザにプッシュ通知で届けます（届く内容は役割によって異なります）。" />
        </div>
        {status === "unsupported" ? (
          <span className="text-xs text-muted">このブラウザでは利用できません</span>
        ) : status === "unconfigured" ? (
          <span className="text-xs text-muted">準備中です</span>
        ) : (
          <Switch on={status === "on"} disabled={status === "working"} onToggle={status === "on" ? disable : enable} />
        )}
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
