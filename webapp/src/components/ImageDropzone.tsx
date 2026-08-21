"use client";

import { useRef, useState } from "react";
import { uploadFile } from "@/lib/uploadFile";

export function ImageDropzone({
  label,
  imageUrl,
  onChange,
  required,
  size = "lg",
}: {
  label: string;
  imageUrl: string;
  onChange: (url: string) => void;
  required?: boolean;
  size?: "sm" | "lg";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const url = await uploadFile(file);
      onChange(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-semibold">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </label>
      <div
        title="ドラッグ＆ドロップ、またはクリックして選択"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border-2 border-dashed text-center ${
          size === "sm" ? "h-16 w-16 p-1" : "aspect-square w-full p-3"
        } ${dragOver ? "border-primary bg-primary/5" : "border-border"}`}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="h-full w-full rounded-lg object-cover" />
        ) : size === "sm" ? (
          <span className="text-lg">🖼</span>
        ) : (
          <>
            <span className="text-2xl">🖼</span>
            <p className="text-xs text-muted">
              画像をドラッグ＆ドロップ
              <br />
              or <span className="text-primary underline">browse files</span>
            </p>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      {uploading ? <p className="mt-1 text-xs text-muted">アップロード中...</p> : null}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
