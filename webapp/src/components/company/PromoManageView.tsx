"use client";

import { useState, useTransition } from "react";
import {
  createPromoItemAction,
  deletePromoItemAction,
  markRedemptionShippedAction,
} from "@/app/company/promo/actions";

type Item = {
  id: string;
  imageUrl: string;
  name: string;
  pointsCost: number;
  stock: number;
  description: string | null;
};

type Redemption = {
  id: string;
  itemName: string;
  staffName: string;
  pointsSpent: number;
  status: string;
  createdAt: string;
};

export function PromoManageView({ items, redemptions }: { items: Item[]; redemptions: Redemption[] }) {
  const [pending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [name, setName] = useState("");
  const [pointsCost, setPointsCost] = useState("");
  const [stock, setStock] = useState("");
  const [description, setDescription] = useState("");

  const pendingShipment = redemptions.filter((r) => r.status === "PENDING_SHIPMENT");

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif-jp text-lg font-bold text-primary">商品一覧</h2>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            {showForm ? "閉じる" : "＋販促品を登録"}
          </button>
        </div>

        {showForm ? (
          <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-border p-4">
            <input
              type="text"
              placeholder="画像URL"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              className="col-span-2 rounded-lg border border-border px-2 py-2 text-sm"
            />
            <input
              type="text"
              placeholder="商品名"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border border-border px-2 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="交換ポイント"
              value={pointsCost}
              onChange={(e) => setPointsCost(e.target.value)}
              className="rounded-lg border border-border px-2 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="在庫数"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              className="rounded-lg border border-border px-2 py-2 text-sm"
            />
            <input
              type="text"
              placeholder="詳細説明文（任意）"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded-lg border border-border px-2 py-2 text-sm"
            />
            <button
              type="button"
              disabled={pending || !imageUrl || !name || !pointsCost || !stock}
              onClick={() =>
                startTransition(async () => {
                  await createPromoItemAction({
                    imageUrl,
                    name,
                    pointsCost: Number(pointsCost),
                    stock: Number(stock),
                    description: description || undefined,
                  });
                  setImageUrl("");
                  setName("");
                  setPointsCost("");
                  setStock("");
                  setDescription("");
                  setShowForm(false);
                })
              }
              className="col-span-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              登録する
            </button>
          </div>
        ) : null}

        <ul className="grid grid-cols-2 gap-3">
          {items.map((i) => (
            <li key={i.id} className="rounded-xl border border-border/60 p-3 text-sm">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">{i.name}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => deletePromoItemAction(i.id))}
                  className="text-xs text-red-600"
                >
                  削除
                </button>
              </div>
              <p className="text-muted">
                {i.pointsCost}pt ／ 在庫 {i.stock}
              </p>
            </li>
          ))}
          {items.length === 0 ? <p className="col-span-2 text-center text-muted">商品がありません。</p> : null}
        </ul>
      </section>

      <section className="rounded-2xl border border-border bg-white/60 p-6">
        <h2 className="mb-3 font-serif-jp text-lg font-bold text-primary">発送待ち</h2>
        {pendingShipment.length === 0 ? (
          <p className="text-sm text-muted">発送待ちの注文はありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pendingShipment.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-lg border border-border/60 p-3 text-sm">
                <span>
                  {r.staffName} — {r.itemName}（{r.pointsSpent}pt）
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(() => markRedemptionShippedAction(r.id))}
                  className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
                >
                  発送済みにする
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
