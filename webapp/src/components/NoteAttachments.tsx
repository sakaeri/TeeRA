"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { PdfLink } from "@/components/PdfLink";
import {
  MAX_NOTE_ATTACHMENTS,
  MAX_NOTE_ATTACHMENT_BYTES,
  NOTE_ATTACHMENT_CONTENT_TYPES,
  NOTE_ATTACHMENT_PATH_PREFIX,
  type NoteAttachmentInput,
  type NoteAttachmentView,
} from "@/lib/noteAttachments";

// メモ作成画面の「画像・PDFを添付」。選んだファイルはその場でアップロードし、
// 終わったものをvalueに入れる（メモの保存はアップロードが終わってから）。
export function NoteAttachmentPicker({
  value,
  onChange,
  onUploadingChange,
}: {
  value: NoteAttachmentInput[];
  onChange: (next: NoteAttachmentInput[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: File[]) {
    setError(null);
    const room = MAX_NOTE_ATTACHMENTS - value.length;
    if (files.length > room) {
      setError(`添付できるのは${MAX_NOTE_ATTACHMENTS}件までです。`);
      files = files.slice(0, Math.max(room, 0));
    }
    const accepted = files.filter((f) => {
      if (!(NOTE_ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(f.type)) {
        setError("画像（JPEG・PNGなど）かPDFを選んでください。");
        return false;
      }
      if (f.size > MAX_NOTE_ATTACHMENT_BYTES) {
        setError("1つのファイルは10MBまでです。");
        return false;
      }
      return true;
    });
    if (accepted.length === 0) return;

    setUploadingCount((n) => n + accepted.length);
    onUploadingChange?.(true);
    const uploaded: NoteAttachmentInput[] = [];
    for (const file of accepted) {
      try {
        const ext = file.name.match(/\.[A-Za-z0-9]{1,5}$/)?.[0]?.toLowerCase() ?? "";
        const blob = await upload(`${NOTE_ATTACHMENT_PATH_PREFIX}${Date.now()}${ext}`, file, {
          access: "public",
          handleUploadUrl: "/api/note-attachments/upload",
          contentType: file.type,
        });
        uploaded.push({ url: blob.url, fileName: file.name, contentType: file.type, size: file.size });
      } catch {
        setError("アップロードできませんでした。もう一度お試しください。");
      }
    }
    onChange([...value, ...uploaded]);
    setUploadingCount((n) => n - accepted.length);
    onUploadingChange?.(false);
  }

  return (
    <div className="mt-2">
      {value.length > 0 ? (
        <ul className="mb-2 flex flex-col gap-1">
          {value.map((a, i) => (
            <li key={a.url} className="flex items-center justify-between gap-2 rounded-lg bg-background px-2 py-1 text-xs">
              <span className="truncate">
                {a.contentType === "application/pdf" ? "📄" : "🖼️"} {a.fileName}
              </span>
              <button
                type="button"
                aria-label={`${a.fileName}を外す`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="shrink-0 text-muted hover:text-red-600"
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
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) handleFiles(files);
        }}
      />
      <button
        type="button"
        disabled={value.length >= MAX_NOTE_ATTACHMENTS || uploadingCount > 0}
        onClick={() => inputRef.current?.click()}
        className="text-xs font-semibold text-primary disabled:opacity-50"
      >
        {uploadingCount > 0 ? "アップロード中…" : `📎 画像・PDFを添付（${MAX_NOTE_ATTACHMENTS}件・1件10MBまで）`}
      </button>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

// メモに付いている画像・PDF。画像は小さく並べ、タップで大きく表示。PDFはアプリ内の表示画面で開く。
export function NoteAttachmentList({ attachments }: { attachments: NoteAttachmentView[] }) {
  const [openImage, setOpenImage] = useState<NoteAttachmentView | null>(null);
  if (attachments.length === 0) return null;
  const images = attachments.filter((a) => !a.isPdf);
  const pdfs = attachments.filter((a) => a.isPdf);

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {images.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpenImage(a);
              }}
              aria-label={`${a.fileName}を大きく表示`}
              className="h-16 w-16 overflow-hidden rounded-lg border border-border bg-background"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 権限を確かめて返すAPIの画像なのでnext/imageの最適化は使わない */}
              <img src={a.href} alt={a.fileName} className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}
      {pdfs.map((a) => (
        <PdfLink key={a.id} href={a.href} className="flex items-center gap-1 text-xs text-primary underline">
          <span aria-hidden>📄</span>
          <span className="truncate">{a.fileName}</span>
        </PdfLink>
      ))}

      {openImage ? (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4"
          onClick={(e) => {
            e.stopPropagation();
            setOpenImage(null);
          }}
        >
          <button
            type="button"
            aria-label="閉じる"
            onClick={(e) => {
              e.stopPropagation();
              setOpenImage(null);
            }}
            className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-primary"
          >
            ✕ 閉じる
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- 同上 */}
          <img
            src={openImage.href}
            alt={openImage.fileName}
            className="max-h-[85vh] max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="mt-2 max-w-full truncate text-xs text-white/80">{openImage.fileName}</p>
        </div>
      ) : null}
    </div>
  );
}
