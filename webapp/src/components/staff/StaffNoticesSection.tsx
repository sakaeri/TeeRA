"use client";

import { useState, useTransition } from "react";
import { markStaffNoticeReadAction } from "@/app/staff/actions";

type Notice = { id: string; message: string; createdAt: string };

export function StaffNoticesSection({ notices }: { notices: Notice[] }) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const visible = notices.filter((n) => !dismissedIds.has(n.id));

  if (visible.length === 0) return null;

  function dismiss(id: string) {
    setDismissedIds((prev) => new Set(prev).add(id));
    startTransition(() => markStaffNoticeReadAction(id));
  }

  return (
    <div className="mb-4 flex flex-col gap-1.5 rounded-2xl border border-accent/30 bg-accent/10 p-3">
      <p className="text-xs font-semibold text-primary">お知らせ</p>
      <ul className="flex flex-col gap-1">
        {visible.map((n) => (
          <li key={n.id} className="flex items-start justify-between gap-2 text-xs text-foreground/90">
            <span>{n.message}</span>
            <button
              type="button"
              onClick={() => dismiss(n.id)}
              aria-label="既読にする"
              className="shrink-0 rounded px-1 text-muted hover:text-primary"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
