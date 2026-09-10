"use client";

import { useState, useTransition } from "react";
import { redeemPromoItemAction } from "@/app/staff/points/actions";

type Item = { id: string; imageUrl: string; name: string; pointsCost: number; stock: number; description: string | null };
type Order = { id: string; itemName: string; pointsSpent: number; status: string; createdAt: string };
type Tier = {
  approvedCount: number;
  rankName: string;
  rankLevel: number;
  currentRate: number;
  tierStart: number;
  tierThreshold: number | null;
  nextRankName: string | null;
};

// ランクごとにバーの色味を変え、切り替わった実感を出す。
const RANK_FILL: Record<number, string> = {
  1: "linear-gradient(90deg, #9c6b45, #cd9868)",
  2: "linear-gradient(90deg, #8a94a0, #d6dde3)",
  3: "linear-gradient(90deg, var(--brand-accent), #f4dfa0)",
};

export function StaffPointsView({
  balance,
  tier,
  items,
  orders,
  savedAddress,
  savedPhone,
}: {
  balance: number;
  tier: Tier;
  items: Item[];
  orders: Order[];
  savedAddress: string;
  savedPhone: string;
}) {
  const [tab, setTab] = useState<"list" | "orders">("list");
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [redeemedIds, setRedeemedIds] = useState<Set<string>>(new Set());
  // 交換できる商品だけでなく、交換不可（在庫切れ／pt不足）の商品も
  // 「これのために頑張ろう」で見られるよう、詳細ポップアップはタップ
  // すれば誰でも開ける。交換フォームはその中で条件を満たす時だけ出す。
  const [detailItem, setDetailItem] = useState<Item | null>(null);
  const [address, setAddress] = useState(savedAddress);
  const [phone, setPhone] = useState(savedPhone);

  function redeem(id: string) {
    startTransition(async () => {
      const result = await redeemPromoItemAction(id, address, phone);
      if (result.error) {
        setErrors((prev) => ({
          ...prev,
          [id]: result.error === "insufficient_points" ? "ポイントが不足しています。" : "在庫がありません。",
        }));
      } else {
        setRedeemedIds((prev) => new Set(prev).add(id));
      }
      setDetailItem(null);
    });
  }

  const tierThreshold = tier.tierThreshold;
  const isMaxRank = tierThreshold === null;
  const tierTotal = isMaxRank ? null : tierThreshold - tier.tierStart;
  const tierProgress = isMaxRank ? null : tier.approvedCount - tier.tierStart;
  const fillPct = isMaxRank ? 100 : Math.min(100, ((tierProgress as number) / (tierTotal as number)) * 100);
  const remaining = isMaxRank ? 0 : tierThreshold - tier.approvedCount;

  return (
    <div className="flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-3xl bg-primary text-primary-foreground shadow-lg">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/20" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-white/5" />

        <div className="relative px-8 pb-7 pt-8 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-accent font-serif-jp text-2xl font-bold text-primary shadow-md ring-4 ring-white/10">
            T
          </div>
          <p className="text-xs uppercase tracking-widest text-primary-foreground/60">保有ポイント</p>
          <p className="mt-1 font-serif-jp text-5xl font-bold">
            {balance}
            <span className="ml-2 text-xl font-normal text-primary-foreground/70">pt</span>
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-xs">
            <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-primary">
              Lv.{tier.rankLevel}
            </span>
            <span className="font-serif-jp font-bold text-accent">現在のランク：{tier.rankName}</span>
            <span className="text-primary-foreground/65">承認1件につき {tier.currentRate}pt</span>
          </div>
        </div>

        <div className="relative mx-8 border-t border-white/15" />

        <div className="relative px-8 pb-7 pt-5 text-left">
          <div className="mb-3.5 flex items-baseline justify-between gap-3">
            <span className="text-xs font-bold text-primary-foreground/85">このランクでの進捗</span>
            <span className="text-[11px] tabular-nums text-primary-foreground/60">
              {isMaxRank ? `承認済み ${tier.approvedCount}件` : `${tierProgress} / ${tierTotal}件`}
            </span>
          </div>
          <div className="relative h-2.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700"
              style={{ width: `${fillPct}%`, background: RANK_FILL[tier.rankLevel] ?? RANK_FILL[1] }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-primary-foreground/55">
            <span>
              現在：<strong className="font-bold text-primary-foreground/85">{tier.rankName}</strong>
            </span>
            <span>
              {isMaxRank ? (
                <strong className="font-bold text-accent">MAX</strong>
              ) : (
                <>
                  次へ：<strong className="font-bold text-primary-foreground/85">{tier.nextRankName}</strong>
                </>
              )}
            </span>
          </div>
          {isMaxRank ? (
            <p className="mt-4 text-[13px] text-primary-foreground/90">
              <strong className="font-bold text-accent">{tier.rankName}</strong>
              ――TeeRAメンバーの最高ランクに到達しています
            </p>
          ) : (
            <p className="mt-4 text-[13px] text-primary-foreground/90">
              次のランク「<strong className="font-bold text-accent">{tier.nextRankName}</strong>」まであと
              <strong className="font-bold text-accent">{remaining}</strong>件
            </p>
          )}
        </div>
      </section>

      <div className="flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setTab("list")}
          className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab === "list" ? "border-accent text-primary" : "border-transparent text-muted"}`}
        >
          商品一覧
        </button>
        <button
          type="button"
          onClick={() => setTab("orders")}
          className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab === "orders" ? "border-accent text-primary" : "border-transparent text-muted"}`}
        >
          交換履歴
        </button>
      </div>

      {tab === "list" ? (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {items.map((i) => {
            const isRedeemed = redeemedIds.has(i.id);
            const outOfStock = i.stock <= 0;
            return (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => setDetailItem(i)}
                  className="block w-full rounded-xl border border-border bg-white/60 p-2 text-left text-sm hover:border-primary"
                >
                  <div className="relative mb-2 aspect-square w-full overflow-hidden rounded-lg bg-background">
                    {i.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={i.imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : null}
                    <span className="absolute left-1.5 top-1.5 rounded-md bg-primary/85 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-primary-foreground">
                      {i.pointsCost}pt
                    </span>
                  </div>
                  <div className="truncate font-medium">{i.name}</div>
                  {isRedeemed || outOfStock ? (
                    <p className="text-xs text-muted">{isRedeemed ? "交換済み" : "在庫切れ"}</p>
                  ) : null}
                </button>
              </li>
            );
          })}
          {items.length === 0 ? <p className="col-span-full text-center text-muted">商品がありません。</p> : null}
        </ul>
      ) : (
        <ul className="flex flex-col gap-2">
          {orders.map((o) => (
            <li key={o.id} className="flex items-center justify-between rounded-lg border border-border/60 p-3 text-sm">
              <span>{o.itemName}</span>
              <span className="text-muted">
                {o.pointsSpent}pt ／ {o.status === "SHIPPED" ? "発送済み" : "発送待ち"}
              </span>
            </li>
          ))}
          {orders.length === 0 ? <p className="text-center text-muted">交換履歴はありません。</p> : null}
        </ul>
      )}

      {detailItem ? (
        <ItemDetailModal
          item={detailItem}
          balance={balance}
          pending={pending}
          isRedeemed={redeemedIds.has(detailItem.id)}
          error={errors[detailItem.id]}
          address={address}
          phone={phone}
          onAddressChange={setAddress}
          onPhoneChange={setPhone}
          onRedeem={() => redeem(detailItem.id)}
          onClose={() => setDetailItem(null)}
        />
      ) : null}
    </div>
  );
}

function ItemDetailModal({
  item,
  balance,
  pending,
  isRedeemed,
  error,
  address,
  phone,
  onAddressChange,
  onPhoneChange,
  onRedeem,
  onClose,
}: {
  item: Item;
  balance: number;
  pending: boolean;
  isRedeemed: boolean;
  error?: string;
  address: string;
  phone: string;
  onAddressChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onRedeem: () => void;
  onClose: () => void;
}) {
  const outOfStock = item.stock <= 0;
  const insufficientPoints = balance < item.pointsCost;
  const canRedeem = !isRedeemed && !outOfStock && !insufficientPoints;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-serif-jp text-lg font-bold text-primary">{item.name}</h3>
          <button type="button" onClick={onClose} className="text-muted">
            ✕
          </button>
        </div>
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt="" className="mb-3 aspect-square w-full rounded-lg object-cover" />
        ) : null}
        <p className="mb-1 font-serif-jp text-lg font-bold text-primary">{item.pointsCost}pt</p>
        {item.description ? <p className="mb-3 text-sm text-muted">{item.description}</p> : null}

        {!canRedeem ? (
          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed rounded-lg bg-border px-4 py-2 text-sm font-semibold text-muted"
          >
            {isRedeemed
              ? "この商品はすでに交換済みです"
              : outOfStock
                ? "現在在庫切れです"
                : `あと${item.pointsCost - balance}pt貯めると交換できます`}
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm">お届け先を入力して交換してください。</p>
            <label className="flex flex-col gap-1 text-xs">
              住所
              <input
                type="text"
                value={address}
                onChange={(e) => onAddressChange(e.target.value)}
                placeholder="例：東京都渋谷区〇〇1-2-3"
                className="rounded-lg border border-border px-2 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              電話番号
              <input
                type="text"
                value={phone}
                onChange={(e) => onPhoneChange(e.target.value)}
                placeholder="例：090-1234-5678"
                className="rounded-lg border border-border px-2 py-2 text-sm"
              />
            </label>
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
            <button
              type="button"
              disabled={pending || !address.trim() || !phone.trim()}
              onClick={onRedeem}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              この内容で交換する
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
