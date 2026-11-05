// 販促品の画像（最大5枚）。DBは imageUrl（1枚目・必須）〜 imageUrl5 の列に順に入れる
export const MAX_PROMO_IMAGES = 5;

type PromoImageColumns = {
  imageUrl: string;
  imageUrl2: string | null;
  imageUrl3: string | null;
  imageUrl4: string | null;
  imageUrl5: string | null;
};

// 列 → 並び順の配列（空きは詰める）
export function promoImageUrls(item: PromoImageColumns): string[] {
  return [item.imageUrl, item.imageUrl2, item.imageUrl3, item.imageUrl4, item.imageUrl5].filter(
    (u): u is string => Boolean(u),
  );
}

// 並び順の配列 → 列（外した画像の列はnullにして消す）
export function promoImageColumns(urls: string[]): PromoImageColumns {
  const list = urls.filter(Boolean).slice(0, MAX_PROMO_IMAGES);
  if (list.length === 0) throw new Error("image_required");
  return {
    imageUrl: list[0],
    imageUrl2: list[1] ?? null,
    imageUrl3: list[2] ?? null,
    imageUrl4: list[3] ?? null,
    imageUrl5: list[4] ?? null,
  };
}
