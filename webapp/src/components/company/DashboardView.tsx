"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import {
  createManualTodoAction,
  resolveTodoAction,
  addTodoCommentAction,
} from "@/app/company/actions-todo";
import {
  createPromoItemAction,
  updatePromoItemAction,
  deletePromoItemAction,
  markRedemptionShippedAction,
} from "@/app/company/promo/actions";
import { approveWorkReportAction, rejectWorkReportAction } from "@/app/company/workreports/actions";
import { generateStaffContractAction } from "@/app/company/contracts/actions";
import { ImageDropzone } from "@/components/ImageDropzone";
import { ConfirmDialog } from "@/components/ConfirmDialog";

const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];
function formatDateJa(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00Z");
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEKDAYS_JA[d.getUTCDay()]}）`;
}
function formatTimeRange(startTime: string | null, endTime: string | null) {
  if (!startTime && !endTime) return "";
  return `${startTime ?? ""}〜${endTime ?? ""}`;
}

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

type ResolvedTodo = {
  id: string;
  title: string;
  dueDate: string;
  createdByName: string;
  recipientName: string;
  resolvedAt: string;
  comments: { id: string; authorName: string; body: string }[];
};

type ShortageEntry = {
  id: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  filled: number;
  maxEntries: number;
};

type UnconfirmedShiftEntry = {
  id: string;
  staffName: string;
  desire: string;
  dates: string[];
  note: string | null;
};

type PendingReportEntry = {
  id: string;
  staffName: string;
  teamName: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  outcome: string;
  clockIn: string | null;
  clockOut: string | null;
  breakMinutes: number;
  computedHours: string;
  comment: string | null;
};

type PendingContractStaff = { userId: string; name: string };
type ContractTemplateOption = { id: string; title: string };

type PromoItem = {
  id: string;
  imageUrl: string;
  name: string;
  pointsCost: number;
  stock: number;
  description: string | null;
};
type PromoOrder = {
  id: string;
  itemName: string;
  staffName: string;
  status: string;
  createdAt: string;
  shippingAddress: string | null;
  shippingPhone: string | null;
};

type DashboardTab = "active" | "resolved" | "promoList" | "promoOrders";

type PopupKind = "shortage" | "unconfirmed" | "reports" | "contracts";

const KPI_CARDS: { key: keyof Kpis; label: string; href?: string; tab?: DashboardTab; popup?: PopupKind }[] = [
  { key: "shortageCount", label: "欠員件数", popup: "shortage" },
  { key: "unconfirmedShiftCount", label: "未確定シフト", popup: "unconfirmed" },
  { key: "pendingReportCount", label: "業務報告未承認", popup: "reports" },
  { key: "pendingContractCount", label: "契約書未確認", popup: "contracts" },
  { key: "promoItemCount", label: "販促品登録数", tab: "promoList" },
  { key: "pendingShipmentCount", label: "発送待ち", tab: "promoOrders" },
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
  currentUserName,
  recipientOptions,
  promoItems,
  promoOrders,
  shortageEntries,
  unconfirmedShiftEntries,
  pendingReportEntries,
  pendingContractStaff,
  contractTemplates,
}: {
  kpis: Kpis;
  autoTodos: AutoTodo[];
  openTodos: OpenTodo[];
  resolvedTodos: ResolvedTodo[];
  currentUserName: string;
  recipientOptions: { id: string; name: string }[];
  promoItems: PromoItem[];
  promoOrders: PromoOrder[];
  shortageEntries: ShortageEntry[];
  unconfirmedShiftEntries: UnconfirmedShiftEntry[];
  pendingReportEntries: PendingReportEntry[];
  pendingContractStaff: PendingContractStaff[];
  contractTemplates: ContractTemplateOption[];
}) {
  const [tab, setTab] = useState<DashboardTab>("active");
  const [showTodoForm, setShowTodoForm] = useState(false);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [editingPromoItem, setEditingPromoItem] = useState<PromoItem | null>(null);
  const [openPopup, setOpenPopup] = useState<PopupKind | null>(null);
  const [reportDetail, setReportDetail] = useState<PendingReportEntry | null>(null);
  const [generateTarget, setGenerateTarget] = useState<PendingContractStaff | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-serif-jp text-2xl font-bold">ダッシュボード</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowPromoModal(true)}
            className="rounded-lg border border-primary bg-white px-4 py-2 text-sm font-semibold text-primary shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            ＋販促品を登録
          </button>
          <button
            type="button"
            onClick={() => setShowTodoForm(true)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            ＋やることリスト作成
          </button>
        </div>
      </div>

      <section className="grid grid-cols-3 gap-4">
        {KPI_CARDS.map((card) =>
          card.tab || card.popup ? (
            <button
              key={card.key}
              type="button"
              onClick={() => (card.popup ? setOpenPopup(card.popup) : setTab(card.tab as DashboardTab))}
              className="rounded-2xl border border-border bg-white/60 p-5 text-left hover:border-primary"
            >
              <p className="text-xs text-muted">{card.label}</p>
              <p className="font-serif-jp text-2xl font-bold text-primary">
                {kpis[card.key]}
                <span className="ml-1 text-xs text-accent">件 ▾</span>
              </p>
            </button>
          ) : (
            <Link
              key={card.key}
              href={card.href!}
              className="rounded-2xl border border-border bg-white/60 p-5 hover:border-primary"
            >
              <p className="text-xs text-muted">{card.label}</p>
              <p className="font-serif-jp text-2xl font-bold text-primary">
                {kpis[card.key]}
                <span className="ml-1 text-xs text-accent">件 ▾</span>
              </p>
            </Link>
          ),
        )}
      </section>

      <TodoSection
        tab={tab}
        setTab={setTab}
        autoTodos={autoTodos}
        openTodos={openTodos}
        resolvedTodos={resolvedTodos}
        promoItems={promoItems}
        promoOrders={promoOrders}
        onEditPromoItem={setEditingPromoItem}
      />

      {showPromoModal ? <PromoItemModal onClose={() => setShowPromoModal(false)} /> : null}
      {editingPromoItem ? (
        <PromoItemModal editingItem={editingPromoItem} onClose={() => setEditingPromoItem(null)} />
      ) : null}
      {showTodoForm ? (
        <TodoModal
          currentUserName={currentUserName}
          recipientOptions={recipientOptions}
          onClose={() => setShowTodoForm(false)}
        />
      ) : null}

      {openPopup === "shortage" ? (
        <ShortagePopup entries={shortageEntries} onClose={() => setOpenPopup(null)} />
      ) : null}
      {openPopup === "unconfirmed" ? (
        <UnconfirmedShiftPopup entries={unconfirmedShiftEntries} onClose={() => setOpenPopup(null)} />
      ) : null}
      {openPopup === "reports" ? (
        <PendingReportsPopup
          entries={pendingReportEntries}
          onSelect={(entry) => {
            setOpenPopup(null);
            setReportDetail(entry);
          }}
          onClose={() => setOpenPopup(null)}
        />
      ) : null}
      {reportDetail ? (
        <WorkReportDetailModal entry={reportDetail} onClose={() => setReportDetail(null)} />
      ) : null}
      {openPopup === "contracts" ? (
        <PendingContractPopup
          staff={pendingContractStaff}
          onSelect={(staff) => {
            setOpenPopup(null);
            setGenerateTarget(staff);
          }}
          onClose={() => setOpenPopup(null)}
        />
      ) : null}
      {generateTarget ? (
        <GenerateContractModal
          staff={generateTarget}
          templates={contractTemplates}
          onClose={() => setGenerateTarget(null)}
        />
      ) : null}
    </div>
  );
}

function TodoModal({
  currentUserName,
  recipientOptions,
  onClose,
}: {
  currentUserName: string;
  recipientOptions: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [recipientUserId, setRecipientUserId] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">やることリストを作成</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-muted">
          担当者に対応してほしい内容を登録します。期日と宛先を指定してください。
        </p>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span>
              内容<span className="text-red-600"> *</span>
            </span>
            <input
              type="text"
              placeholder="やることを入力"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-lg border border-border px-2 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span>
              いつまでにやるか（目安日）<span className="text-red-600"> *</span>
            </span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="rounded-lg border border-border px-2 py-2 text-sm"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs">
              誰が出したか
              <input
                type="text"
                value={`${currentUserName}（自動入力）`}
                disabled
                className="rounded-lg border border-border bg-background px-2 py-2 text-sm text-muted"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span>
                誰宛か<span className="text-red-600"> *</span>
              </span>
              <select
                value={recipientUserId}
                onChange={(e) => setRecipientUserId(e.target.value)}
                className="rounded-lg border border-border px-2 py-2 text-sm"
              >
                <option value="">選択してください</option>
                {recipientOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ImageDropzone label="画像添付（任意）" imageUrl={imageUrl} onChange={setImageUrl} size="sm" />
        </div>

        <button
          type="button"
          disabled={pending || !title || !dueDate || !recipientUserId}
          onClick={() =>
            startTransition(async () => {
              await createManualTodoAction({ title, dueDate, recipientUserId, imageUrl: imageUrl || undefined });
              onClose();
            })
          }
          className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          作成する
        </button>
      </div>
    </div>
  );
}

function PromoItemModal({ editingItem, onClose }: { editingItem?: PromoItem; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [imageUrl, setImageUrl] = useState(editingItem?.imageUrl ?? "");
  const [name, setName] = useState(editingItem?.name ?? "");
  const [pointsCost, setPointsCost] = useState(editingItem ? String(editingItem.pointsCost) : "");
  const [stock, setStock] = useState(editingItem ? String(editingItem.stock) : "");
  const [description, setDescription] = useState(editingItem?.description ?? "");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const canSubmit = Boolean(imageUrl) && Boolean(name) && Boolean(pointsCost) && Boolean(stock);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">
            販促品を{editingItem ? "編集" : "登録"}
          </h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <ImageDropzone label="商品画像" imageUrl={imageUrl} onChange={setImageUrl} required />
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span>
                商品名<span className="text-red-600"> *</span>
              </span>
              <input
                type="text"
                placeholder="例：オリジナルタオル"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-lg border border-border px-2 py-2 text-sm"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs">
              詳細説明文（任意）
              <textarea
                placeholder="商品の説明など"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="flex-1 resize-none rounded-lg border border-border px-2 py-2 text-sm"
              />
            </label>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-xs">
            <span>
              交換ポイント<span className="text-red-600"> *</span>
            </span>
            <input
              type="number"
              placeholder="例：500"
              value={pointsCost}
              onChange={(e) => setPointsCost(e.target.value)}
              className="rounded-lg border border-border px-2 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span>
              在庫数<span className="text-red-600"> *</span>
            </span>
            <input
              type="number"
              placeholder="例：20"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              className="rounded-lg border border-border px-2 py-2 text-sm"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted">
          交換ポイント: スタッフが業務報告を行うとたまるポイントです。たまったポイントで、この販促品と交換できます。商品の価値に見合ったポイント数を設定してください。
        </p>

        <button
          type="button"
          disabled={pending || !canSubmit}
          onClick={() =>
            startTransition(async () => {
              const payload = {
                imageUrl,
                name,
                pointsCost: Number(pointsCost),
                stock: Number(stock),
                description: description || undefined,
              };
              if (editingItem) {
                await updatePromoItemAction(editingItem.id, payload);
              } else {
                await createPromoItemAction(payload);
              }
              onClose();
            })
          }
          className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          保存する
        </button>

        {editingItem ? (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="mt-3 w-full text-center text-sm text-red-600"
          >
            この販促品を削除する
          </button>
        ) : null}
      </div>

      {showDeleteConfirm && editingItem ? (
        <ConfirmDialog
          message={`「${editingItem.name}」を削除しますか？`}
          confirmLabel="削除する"
          pending={pending}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={() =>
            startTransition(async () => {
              await deletePromoItemAction(editingItem.id);
              onClose();
            })
          }
        />
      ) : null}
    </div>
  );
}

function PopupShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">{title}</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-muted">{subtitle}</p>
        <div className="flex flex-col gap-2">{children}</div>
      </div>
    </div>
  );
}

function ShortagePopup({ entries, onClose }: { entries: ShortageEntry[]; onClose: () => void }) {
  return (
    <PopupShell
      title="欠員シフト"
      subtitle="担当スタッフが決まっていない募集中のシフトです。ここから直接割当できます"
      onClose={onClose}
    >
      {entries.map((r) => (
        <div key={r.id} className="flex items-center justify-between rounded-xl border border-border/60 p-4 text-sm">
          <div>
            <p className="font-medium">{formatDateJa(r.date)}</p>
            <p className="text-muted">
              {r.title} {formatTimeRange(r.startTime, r.endTime)} 残り{r.maxEntries - r.filled}名（{r.filled}/
              {r.maxEntries}）
            </p>
          </div>
          <Link
            href={`/company/calendar?date=${r.date}`}
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            カレンダーで確認
          </Link>
        </div>
      ))}
      {entries.length === 0 ? <p className="text-center text-muted">欠員のあるシフトはありません。</p> : null}
    </PopupShell>
  );
}

const DESIRE_LABEL: Record<string, string> = {
  WORK: "出勤希望",
  OFF: "休み希望",
};

function UnconfirmedShiftPopup({ entries, onClose }: { entries: UnconfirmedShiftEntry[]; onClose: () => void }) {
  return (
    <PopupShell
      title="未確定シフト"
      subtitle="スタッフから提出された希望シフトです。ここから直接カレンダーで確認できます"
      onClose={onClose}
    >
      {entries.map((r) => (
        <div key={r.id} className="flex items-center justify-between rounded-xl border border-border/60 p-4 text-sm">
          <div>
            <p className="font-medium">
              {r.staffName}さん（{DESIRE_LABEL[r.desire] ?? r.desire}）
            </p>
            <p className="text-muted">
              {r.dates.map((d) => formatDateJa(d)).join("、")}
              {r.note ? ` ・${r.note}` : ""}
            </p>
          </div>
          <Link
            href={`/company/calendar?date=${r.dates[0]}`}
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            カレンダーで確認
          </Link>
        </div>
      ))}
      {entries.length === 0 ? <p className="text-center text-muted">未確定の希望シフトはありません。</p> : null}
    </PopupShell>
  );
}

function PendingReportsPopup({
  entries,
  onSelect,
  onClose,
}: {
  entries: PendingReportEntry[];
  onSelect: (entry: PendingReportEntry) => void;
  onClose: () => void;
}) {
  return (
    <PopupShell title="業務報告未承認" subtitle="確認して承認・差戻しを行ってください" onClose={onClose}>
      {entries.map((r) => (
        <div key={r.id} className="flex items-center justify-between rounded-xl border border-border/60 p-4 text-sm">
          <div>
            <p className="font-medium">{r.staffName}</p>
            <p className="text-muted">
              {r.teamName ?? "自社"}・{formatDateJa(r.date)}・{formatTimeRange(r.startTime, r.endTime)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onSelect(r)}
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            確認する
          </button>
        </div>
      ))}
      {entries.length === 0 ? <p className="text-center text-muted">承認待ちの業務報告はありません。</p> : null}
    </PopupShell>
  );
}

function WorkReportDetailModal({ entry, onClose }: { entry: PendingReportEntry; onClose: () => void }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">業務報告の確認</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-muted">
          {entry.staffName}・{entry.teamName ?? "自社"}・{formatDateJa(entry.date)}
        </p>

        {entry.outcome === "出勤した" ? (
          <>
            <p className="mb-2 text-xs font-semibold text-muted">タイムカード（アプリ打刻）</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-background p-3">
                <p className="text-xs text-muted">出勤</p>
                <p className="text-lg font-semibold">{entry.clockIn ?? "—"}</p>
              </div>
              <div className="rounded-xl bg-background p-3">
                <p className="text-xs text-muted">退勤</p>
                <p className="text-lg font-semibold">{entry.clockOut ?? "—"}</p>
              </div>
              <div className="rounded-xl bg-background p-3">
                <p className="text-xs text-muted">休憩時間</p>
                <p className="text-lg font-semibold">
                  {entry.breakMinutes > 0 ? `${entry.breakMinutes}分` : "—"}
                </p>
              </div>
              <div className="rounded-xl bg-background p-3">
                <p className="text-xs text-muted">実働時間</p>
                <p className="text-lg font-semibold">{entry.computedHours}時間</p>
              </div>
            </div>
          </>
        ) : (
          <p className="rounded-xl bg-background p-3 text-sm">{entry.outcome}</p>
        )}

        <p className="mb-1 mt-4 text-xs font-semibold text-muted">本人のコメント</p>
        <p className="text-sm">{entry.comment || "コメントはありません"}</p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await approveWorkReportAction(entry.id);
                onClose();
              })
            }
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            承認する
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await rejectWorkReportAction(entry.id);
                onClose();
              })
            }
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-foreground/70 disabled:opacity-60"
          >
            差し戻す
          </button>
        </div>
      </div>
    </div>
  );
}

function PendingContractPopup({
  staff,
  onSelect,
  onClose,
}: {
  staff: PendingContractStaff[];
  onSelect: (staff: PendingContractStaff) => void;
  onClose: () => void;
}) {
  return (
    <PopupShell title="契約書未確認" subtitle="未締結の契約書です" onClose={onClose}>
      {staff.map((s) => (
        <div key={s.userId} className="flex items-center justify-between rounded-xl border border-border/60 p-4 text-sm">
          <div className="flex items-center gap-2">
            <p className="font-medium">{s.name}</p>
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-800">未送付</span>
          </div>
          <button
            type="button"
            onClick={() => onSelect(s)}
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            契約書を生成
          </button>
        </div>
      ))}
      {staff.length === 0 ? <p className="text-center text-muted">未締結の契約書はありません。</p> : null}
    </PopupShell>
  );
}

function GenerateContractModal({
  staff,
  templates,
  onClose,
}: {
  staff: PendingContractStaff;
  templates: ContractTemplateOption[];
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [templateId, setTemplateId] = useState("");

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">契約書を生成</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-muted">{staff.name}さんに契約書を割り当てて締結します</p>

        {templates.length === 0 ? (
          <p className="text-sm text-muted">利用できる契約書テンプレートがありません。先にテンプレートを作成してください。</p>
        ) : (
          <label className="flex flex-col gap-1 text-xs">
            <span>
              テンプレート<span className="text-red-600"> *</span>
            </span>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="rounded-lg border border-border px-2 py-2 text-sm"
            >
              <option value="">選択してください</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          disabled={pending || !templateId}
          onClick={() =>
            startTransition(async () => {
              await generateStaffContractAction(templateId, staff.userId);
              onClose();
            })
          }
          className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          生成する
        </button>
      </div>
    </div>
  );
}

function TodoSection({
  tab,
  setTab,
  autoTodos,
  openTodos,
  resolvedTodos,
  promoItems,
  promoOrders,
  onEditPromoItem,
}: {
  tab: DashboardTab;
  setTab: (t: DashboardTab) => void;
  autoTodos: AutoTodo[];
  openTodos: OpenTodo[];
  resolvedTodos: ResolvedTodo[];
  promoItems: PromoItem[];
  promoOrders: PromoOrder[];
  onEditPromoItem: (item: PromoItem) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [orderFilter, setOrderFilter] = useState<"all" | "pending">("all");
  const [pageSize, setPageSize] = useState(10);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [shipConfirmId, setShipConfirmId] = useState<string | null>(null);

  const filteredOrders =
    orderFilter === "pending" ? promoOrders.filter((o) => o.status !== "SHIPPED") : promoOrders;
  const visibleOrders = filteredOrders.slice(0, pageSize);
  const shipConfirmOrder = promoOrders.find((o) => o.id === shipConfirmId) ?? null;

  return (
    <section className="rounded-2xl border border-border bg-white/60 p-6">
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
            onClick={() => setTab(t.key as DashboardTab)}
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
            <li key={t.id} className="rounded-lg border border-border/60 p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p>{t.title}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {t.createdByName} → {t.recipientName}宛（解決日 {t.resolvedAt}）
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                  className="shrink-0 text-xs text-muted underline"
                >
                  コメント（{t.comments.length}）
                </button>
              </div>
              {expandedId === t.id ? (
                <div className="mt-2 border-t border-border/50 pt-2">
                  {t.comments.map((c) => (
                    <p key={c.id} className="text-xs text-muted">
                      {c.authorName}: {c.body}
                    </p>
                  ))}
                  {t.comments.length === 0 ? <p className="text-xs text-muted">コメントはありません。</p> : null}
                </div>
              ) : null}
            </li>
          ))}
          {resolvedTodos.length === 0 ? <p className="text-center text-muted">対応済みのリストはありません。</p> : null}
        </ul>
      ) : null}

      {tab === "promoList" ? (
        <div>
          <p className="mb-3 text-xs text-muted">登録済みの販促品一覧です（{promoItems.length}件）</p>
          <div className="grid grid-cols-4 gap-4">
            {promoItems.map((p) => (
              <div key={p.id} className="flex flex-col gap-2">
                <div className="relative">
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt="" className="aspect-square w-full rounded-xl object-cover" />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded-xl border-2 border-dashed border-border text-xs text-muted">
                      画像なし
                    </div>
                  )}
                  <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-semibold text-primary shadow">
                    残{p.stock}個
                  </span>
                </div>
                <p className="text-sm font-medium">{p.name}</p>
                <button
                  type="button"
                  onClick={() => onEditPromoItem(p)}
                  className="w-full rounded-lg border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
                >
                  編集
                </button>
              </div>
            ))}
          </div>
          {promoItems.length === 0 ? <p className="text-center text-muted">販促品が登録されていません。</p> : null}
        </div>
      ) : null}

      {tab === "promoOrders" ? (
        <div>
          <div className="mb-3 flex items-center justify-end gap-2">
            <Link
              href="/api/promo/pending-shipment-pdf"
              target="_blank"
              className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
            >
              発送待ちをPDF出力
            </Link>
            <select
              value={orderFilter}
              onChange={(e) => setOrderFilter(e.target.value as "all" | "pending")}
              className="rounded-lg border border-border px-2 py-1.5 text-xs"
            >
              <option value="all">すべて</option>
              <option value="pending">発送待ち</option>
            </select>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="rounded-lg border border-border px-2 py-1.5 text-xs"
            >
              {[10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  表示数{n}件
                </option>
              ))}
            </select>
          </div>

          <ul className="flex flex-col gap-2">
            {visibleOrders.map((o) => {
              const expanded = expandedOrderId === o.id;
              return (
                <li key={o.id} className="rounded-lg border border-border/60 p-3 text-sm">
                  <button
                    type="button"
                    onClick={() => setExpandedOrderId(expanded ? null : o.id)}
                    className="flex w-full items-center justify-between text-left"
                  >
                    <span>
                      <span className="font-medium">{o.itemName}</span>
                      <span className="ml-2 text-muted">
                        注文者：{o.staffName} 注文日：{o.createdAt} 発送日：{o.status === "SHIPPED" ? "済" : "未定"}
                      </span>
                      {o.status !== "SHIPPED" ? (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">発送待ち</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-muted">{expanded ? "▲" : "▼"}</span>
                  </button>
                  {expanded ? (
                    <div className="mt-2 border-t border-border/50 pt-2 text-xs">
                      <p>住所：{o.shippingAddress || "未登録"}</p>
                      <p>電話番号：{o.shippingPhone || "未登録"}</p>
                      {o.status !== "SHIPPED" ? (
                        <button
                          type="button"
                          onClick={() => setShipConfirmId(o.id)}
                          className="mt-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                        >
                          発送済みにする
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
            {visibleOrders.length === 0 ? <p className="text-center text-muted">注文履歴はありません。</p> : null}
          </ul>
        </div>
      ) : null}

      {shipConfirmOrder ? (
        <ConfirmDialog
          message={`${shipConfirmOrder.itemName}を${shipConfirmOrder.staffName}さんに発送済みにしますか？`}
          confirmLabel="発送済みにする"
          pending={pending}
          danger={false}
          onCancel={() => setShipConfirmId(null)}
          onConfirm={() =>
            startTransition(async () => {
              await markRedemptionShippedAction(shipConfirmOrder.id);
              setShipConfirmId(null);
            })
          }
        />
      ) : null}
    </section>
  );
}
