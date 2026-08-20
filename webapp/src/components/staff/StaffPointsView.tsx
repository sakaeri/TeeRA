"use client";

import { useState, useTransition } from "react";
import { redeemPromoItemAction } from "@/app/staff/points/actions";

type Item = { id: string; imageUrl: string; name: string; pointsCost: number; stock: number; description: string | null };
type Order = { id: string; itemName: string; pointsSpent: number; status: string; createdAt: string };
type Tier = { approvedCount: number; currentRate: number; nextThreshold: number | null; remaining: number };

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
  const [redeemTarget, setRedeemTarget] = useState<Item | null>(null);
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
      setRedeemTarget(null);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border-2 border-primary bg-white/60 p-6 text-center">
        <p className="text-sm text-muted">保有ポイント</p>
        <p className="font-serif-jp text-3xl font-bold text-primary">{balance}pt</p>
        <p className="mt-2 text-xs text-muted">
          承認済み業務報告 {tier.approvedCount}件（現在 {tier.currentRate}pt/件）
          {tier.nextThreshold ? ` ／ 次のランクまで残り${tier.remaining}件` : " ／ 最高ランクです"}
        </p>
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
        <ul className="grid grid-cols-2 gap-3">
          {items.map((i) => {
            const isRedeemed = redeemedIds.has(i.id);
            const disabled = pending || i.stock <= 0 || balance < i.pointsCost || isRedeemed;
            return (
              <li key={i.id} className="rounded-xl border border-border bg-white/60 p-3 text-sm">
                {i.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.imageUrl} alt="" className="mb-2 h-24 w-full rounded-lg object-cover" />
                ) : null}
                <div className="mb-1 font-medium">{i.name}</div>
                <p className="text-muted">
                  {i.pointsCost}pt ／ 在庫 {i.stock}
                </p>
                {i.description ? <p className="mt-1 text-xs text-muted">{i.description}</p> : null}
                {errors[i.id] ? <p className="mt-1 text-xs text-red-600">{errors[i.id]}</p> : null}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setRedeemTarget(i)}
                  className="mt-2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {isRedeemed ? "交換済み" : i.stock <= 0 ? "在庫切れ" : "交換する"}
                </button>
              </li>
            );
          })}
          {items.length === 0 ? <p className="col-span-2 text-center text-muted">商品がありません。</p> : null}
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

      {redeemTarget ? (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setRedeemTarget(null)}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-serif-jp text-lg font-bold text-primary">配送先を確認</h3>
              <button type="button" onClick={() => setRedeemTarget(null)} className="text-muted">
                ✕
              </button>
            </div>
            <p className="mb-3 text-sm">
              「{redeemTarget.name}」（{redeemTarget.pointsCost}pt）と交換します。お届け先を入力してください。
            </p>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs">
                住所
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="例：東京都渋谷区〇〇1-2-3"
                  className="rounded-lg border border-border px-2 py-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                電話番号
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="例：090-1234-5678"
                  className="rounded-lg border border-border px-2 py-2 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={pending || !address.trim() || !phone.trim()}
                onClick={() => redeem(redeemTarget.id)}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                この内容で交換する
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
