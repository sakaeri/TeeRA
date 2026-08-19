"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  createManualTodoAction,
  resolveTodoAction,
  reopenTodoAction,
  addTodoCommentAction,
} from "@/app/company/actions-todo";

type Kpis = {
  shortageCount: number;
  unconfirmedShiftCount: number;
  pendingReportCount: number;
  pendingContractCount: number;
  promoItemCount: number;
  pendingShipmentCount: number;
};

type AutoTodo = { id: string; kind: string; text: string; actionLabel: string; actionHref: string };

type OpenTodo = {
  id: string;
  title: string;
  dueDate: string;
  recipientName: string;
  comments: { id: string; authorName: string; body: string }[];
};

type ResolvedTodo = { id: string; title: string; dueDate: string; recipientName: string; resolvedAt: string };

type PromoItem = { id: string; name: string; pointsCost: number; stock: number };
type PromoOrder = { id: string; itemName: string; staffName: string; status: string; createdAt: string };

const KPI_CARDS: { key: keyof Kpis; label: string; href: string }[] = [
  { key: "shortageCount", label: "欠員件数", href: "/company/calendar" },
  { key: "unconfirmedShiftCount", label: "未確定シフト", href: "/company/calendar" },
  { key: "pendingReportCount", label: "業務報告未承認", href: "/company/workreports" },
  { key: "pendingContractCount", label: "契約書未確認", href: "/company/contracts" },
  { key: "promoItemCount", label: "販促品登録数", href: "/company/promo" },
  { key: "pendingShipmentCount", label: "発送待ち", href: "/company/promo" },
];

const TAG_STYLE: Record<string, string> = {
  リスト: "bg-emerald-100 text-emerald-800",
  業務報告: "bg-violet-100 text-violet-800",
  欠員: "bg-rose-100 text-rose-800",
  シフト: "bg-pink-100 text-pink-800",
  契約書: "bg-gray-200 text-gray-700",
  販促品: "bg-amber-100 text-amber-800",
};

function Tag({ kind }: { kind: string }) {
  return (
    <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${TAG_STYLE[kind] ?? "bg-gray-100 text-gray-700"}`}>
      {kind}
    </span>
  );
}

export function DashboardView({
  kpis,
  autoTodos,
  openTodos,
  resolvedTodos,
  staffOptions,
  promoItems,
  promoOrders,
}: {
  kpis: Kpis;
  autoTodos: AutoTodo[];
  openTodos: OpenTodo[];
  resolvedTodos: ResolvedTodo[];
  staffOptions: { id: string; name: string }[];
  promoItems: PromoItem[];
  promoOrders: PromoOrder[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="grid grid-cols-3 gap-4">
        {KPI_CARDS.map((card) => (
          <Link
            key={card.key}
            href={card.href}
            className="rounded-2xl border border-border bg-white/60 p-5 hover:border-primary"
          >
            <p className="text-xs text-muted">{card.label}</p>
            <p className="font-serif-jp text-2xl font-bold text-primary">
              {kpis[card.key]}
              <span className="ml-1 text-xs text-accent">件 ▾</span>
            </p>
          </Link>
        ))}
      </section>

      <TodoSection
        autoTodos={autoTodos}
        openTodos={openTodos}
        resolvedTodos={resolvedTodos}
        staffOptions={staffOptions}
        promoItems={promoItems}
        promoOrders={promoOrders}
      />
    </div>
  );
}

function TodoSection({
  autoTodos,
  openTodos,
  resolvedTodos,
  staffOptions,
  promoItems,
  promoOrders,
}: {
  autoTodos: AutoTodo[];
  openTodos: OpenTodo[];
  resolvedTodos: ResolvedTodo[];
  staffOptions: { id: string; name: string }[];
  promoItems: PromoItem[];
  promoOrders: PromoOrder[];
}) {
  const [tab, setTab] = useState<"active" | "resolved" | "promoList" | "promoOrders">("active");
  const [showForm, setShowForm] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [recipientUserId, setRecipientUserId] = useState(staffOptions[0]?.id ?? "");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");

  return (
    <section className="rounded-2xl border border-border bg-white/60 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif-jp text-lg font-bold text-primary">やることリスト</h2>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          {showForm ? "閉じる" : "＋やることリスト作成"}
        </button>
      </div>

      {showForm ? (
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-border p-4">
          <input
            type="text"
            placeholder="タイトル"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="col-span-2 rounded-lg border border-border px-2 py-2 text-sm"
          />
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded-lg border border-border px-2 py-2 text-sm"
          />
          <select
            value={recipientUserId}
            onChange={(e) => setRecipientUserId(e.target.value)}
            className="rounded-lg border border-border px-2 py-2 text-sm"
          >
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending || !title || !dueDate || !recipientUserId}
            onClick={() =>
              startTransition(async () => {
                await createManualTodoAction({ title, dueDate, recipientUserId });
                setTitle("");
                setDueDate("");
                setShowForm(false);
              })
            }
            className="col-span-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            作成する
          </button>
        </div>
      ) : null}

      <div className="mb-3 flex gap-1 border-b border-border">
        {[
          { key: "active", label: "やることリスト" },
          { key: "resolved", label: "解決済みリスト" },
          { key: "promoList", label: "販促品一覧" },
          { key: "promoOrders", label: "販促品注文履歴" },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key as typeof tab)}
            className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab === t.key ? "border-accent text-primary" : "border-transparent text-muted"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "active" ? (
        <ul className="flex flex-col gap-2">
          {autoTodos.map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-lg border border-border/60 p-3 text-sm">
              <Tag kind={item.kind} />
              <span className="flex-1">{item.text}</span>
              <Link
                href={item.actionHref}
                className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
              >
                {item.actionLabel}
              </Link>
            </li>
          ))}
          {openTodos.map((t) => (
            <li key={t.id} className="rounded-lg border border-border/60 p-3 text-sm">
              <div className="flex items-center gap-3">
                <Tag kind="リスト" />
                <span className="flex-1">
                  {t.title} — {t.recipientName}宛（期限 {t.dueDate}）
                </span>
                <button
                  type="button"
                  onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                  className="shrink-0 text-xs text-muted underline"
                >
                  コメント（{t.comments.length}）
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => resolveTodoAction(t.id))}
                  className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
                >
                  解決済みにする
                </button>
              </div>
              {expandedId === t.id ? (
                <div className="mt-2 border-t border-border/50 pt-2">
                  {t.comments.map((c) => (
                    <p key={c.id} className="text-xs text-muted">
                      {c.authorName}: {c.body}
                    </p>
                  ))}
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      placeholder="コメントを追加"
                      className="flex-1 rounded-lg border border-border px-2 py-1 text-xs"
                    />
                    <button
                      type="button"
                      disabled={pending || !commentDraft}
                      onClick={() =>
                        startTransition(async () => {
                          await addTodoCommentAction(t.id, commentDraft);
                          setCommentDraft("");
                        })
                      }
                      className="rounded-lg border border-primary px-3 py-1 text-xs text-primary"
                    >
                      送信
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
          {autoTodos.length === 0 && openTodos.length === 0 ? (
            <p className="text-center text-muted">未対応のリストはありません。</p>
          ) : null}
        </ul>
      ) : null}

      {tab === "resolved" ? (
        <ul className="flex flex-col gap-2">
          {resolvedTodos.map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded-lg border border-border/60 p-3 text-sm">
              <span>
                {t.title} — {t.recipientName}宛（対応日 {t.resolvedAt}）
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => reopenTodoAction(t.id))}
                className="text-xs text-muted underline"
              >
                再オープン
              </button>
            </li>
          ))}
          {resolvedTodos.length === 0 ? <p className="text-center text-muted">対応済みのリストはありません。</p> : null}
        </ul>
      ) : null}

      {tab === "promoList" ? (
        <ul className="flex flex-col gap-2">
          {promoItems.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-lg border border-border/60 p-3 text-sm">
              <span>{p.name}</span>
              <span className="text-muted">
                {p.pointsCost}pt ／ 在庫 {p.stock}
              </span>
            </li>
          ))}
          {promoItems.length === 0 ? <p className="text-center text-muted">販促品が登録されていません。</p> : null}
        </ul>
      ) : null}

      {tab === "promoOrders" ? (
        <ul className="flex flex-col gap-2">
          {promoOrders.map((o) => (
            <li key={o.id} className="flex items-center justify-between rounded-lg border border-border/60 p-3 text-sm">
              <span>
                {o.staffName} — {o.itemName}
              </span>
              <span className="text-muted">
                {o.createdAt} ／ {o.status === "SHIPPED" ? "発送済み" : "発送待ち"}
              </span>
            </li>
          ))}
          {promoOrders.length === 0 ? <p className="text-center text-muted">注文履歴はありません。</p> : null}
        </ul>
      ) : null}
    </section>
  );
}
