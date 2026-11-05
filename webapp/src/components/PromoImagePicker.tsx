"use client";

import { useRef, useState } from "react";
import { uploadFile } from "@/lib/uploadFile";
import { MAX_PROMO_IMAGES } from "@/lib/promoImages";

const MAX_BYTES = 8 * 1024 * 1024;

// 販促品の画像（最大5枚・画像のみ）。お知らせの添付と同じく「📎 画像を添付」で選び、
// 選んだ画像はその場でアップロードして並べる。1枚目が一覧に出るメインの画像。
export function PromoImagePicker({
  value,
  onChange,
  onUploadingChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: File[]) {
    setError(null);
    const room = MAX_PROMO_IMAGES - value.length;
    if (files.length > room) {
      setError(`画像は${MAX_PROMO_IMAGES}枚までです。`);
      files = files.slice(0, Math.max(room, 0));
    }
    const accepted = files.filter((f) => {
      if (!f.type.startsWith("image/")) {
        setError("画像（JPEG・PNGなど）を選んでください。");
        return false;
      }
      if (f.size > MAX_BYTES) {
        setError("1枚8MBまでです。");
        return false;
      }
      return true;
    });
    if (accepted.length === 0) return;

    setUploadingCount((n) => n + accepted.length);
    onUploadingChange?.(true);
    const uploaded: string[] = [];
    for (const file of accepted) {
      try {
        uploaded.push(await uploadFile(file));
      } catch {
        setError("アップロードできませんでした。もう一度お試しください。");
      }
    }
    onChange([...value, ...uploaded]);
    setUploadingCount((n) => n - accepted.length);
    onUploadingChange?.(false);
  }

  return (
    <div>
      {value.length > 0 ? (
        <ul className="mb-2 grid grid-cols-5 gap-1.5">
          {value.map((url, i) => (
            <li key={url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`商品画像${i + 1}`} className="aspect-square w-full rounded-lg border border-border object-cover" />
              {i === 0 ? (
                <span className="absolute bottom-0.5 left-0.5 rounded bg-primary/90 px-1 text-[9px] font-semibold text-primary-foreground">
                  メイン
                </span>
              ) : null}
              <button
                type="button"
                aria-label={`商品画像${i + 1}を外す`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] text-muted shadow ring-1 ring-border hover:text-red-600"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) handleFiles(files);
        }}
      />
      <button
        type="button"
        disabled={value.length >= MAX_PROMO_IMAGES || uploadingCount > 0}
        onClick={() => inputRef.current?.click()}
        className="text-xs font-semibold text-primary disabled:opacity-50"
      >
        {uploadingCount > 0 ? "アップロード中…" : `📎 画像を添付（${MAX_PROMO_IMAGES}枚・1枚8MBまで）`}
      </button>
      <p className="mt-1 text-[11px] text-muted">1枚目が一覧に出るメインの画像です。</p>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
