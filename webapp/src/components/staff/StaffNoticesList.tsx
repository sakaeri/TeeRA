"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { markStaffNoticeReadAction, markAllStaffNoticesReadAction } from "@/app/staff/actions";
import { NoteAttachmentList } from "@/components/NoteAttachments";
import type { NoteAttachmentView } from "@/lib/noteAttachments";

type Notice = {
  id: string;
  companyId: string;
  companyName: string;
  title: string;
  body: string;
  attachments: NoteAttachmentView[];
  edited: boolean;
  createdAt: string;
  read: boolean;
};

function formatDate(iso: string) {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// スタッフの「お知らせ」。会社名・タイトル・掲載日を新しい順に並べ、未読は太字。
// 押すと本文と添付が開いて既読になる。会社で絞り込み、すべて既読にもできる。
export function StaffNoticesList({ notices, initialOpenId }: { notices: Notice[]; initialOpenId: string | null }) {
  const [, startTransition] = useTransition();
  const [companyId, setCompanyId] = useState("");
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [readIds, setReadIds] = useState<Set<string>>(
    () => new Set(notices.filter((n) => n.read || n.id === initialOpenId).map((n) => n.id)),
  );
  // ホームから開いて来たお知らせは、開いた時点で既読にする（1回だけ）
  const markedInitial = useRef(false);
  useEffect(() => {
    if (markedInitial.current) return;
    markedInitial.current = true;
    if (initialOpenId && notices.some((n) => n.id === initialOpenId && !n.read)) {
      startTransition(() => markStaffNoticeReadAction(initialOpenId));
    }
  }, [initialOpenId, notices]);

  const companies = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notices) map.set(n.companyId, n.companyName);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [notices]);
  const visible = notices.filter((n) => !companyId || n.companyId === companyId);
  const unreadCount = visible.filter((n) => !readIds.has(n.id)).length;

  function open(n: Notice) {
    setOpenId((cur) => (cur === n.id ? null : n.id));
    if (!readIds.has(n.id)) {
      setReadIds((prev) => new Set(prev).add(n.id));
      startTransition(() => markStaffNoticeReadAction(n.id));
    }
  }

  function markAll() {
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const n of visible) next.add(n.id);
      return next;
    });
    startTransition(() => markAllStaffNoticesReadAction(companyId || null));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {companies.length > 1 ? (
          <select
            aria-label="会社で絞り込む"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm"
          >
            <option value="">すべての会社</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="flex-1" />
        )}
        <button
          type="button"
          disabled={unreadCount === 0}
          onClick={markAll}
          className="shrink-0 rounded-lg border border-primary px-3 py-2 text-sm font-semibold text-primary disabled:border-border disabled:text-muted"
        >
          すべて既読にする
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">お知らせはありません。</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-white">
          {visible.map((n) => {
            const unread = !readIds.has(n.id);
            const isOpen = openId === n.id;
            return (
              <li key={n.id}>
                <button type="button" onClick={() => open(n)} aria-expanded={isOpen} className="flex w-full flex-col gap-0.5 px-4 py-3 text-left">
                  <span className="flex items-center justify-between gap-2 text-xs text-muted">
                    <span className="min-w-0 truncate">{n.companyName}</span>
                    <span className="shrink-0">{formatDate(n.createdAt)}</span>
                  </span>
                  <span className={`flex items-center gap-1.5 text-sm ${unread ? "font-bold text-foreground" : "text-foreground/80"}`}>
                    {unread ? <span aria-label="未読" className="h-2 w-2 shrink-0 rounded-full bg-red-600" /> : null}
                    <span className="min-w-0 break-words">{n.title}</span>
                  </span>
                </button>
                {isOpen ? (
                  <div className="px-4 pb-4">
                    {n.body ? <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">{n.body}</p> : null}
                    <NoteAttachmentList attachments={n.attachments} />
                    {n.edited ? <p className="mt-2 text-xs text-muted">（編集済み）</p> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
