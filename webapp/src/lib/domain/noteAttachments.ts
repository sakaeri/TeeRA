import { del } from "@vercel/blob";
import {
  MAX_NOTE_ATTACHMENTS,
  MAX_NOTE_ATTACHMENT_BYTES,
  NOTE_ATTACHMENT_CONTENT_TYPES,
  NOTE_ATTACHMENT_PATH_PREFIX,
  type NoteAttachmentInput,
} from "@/lib/noteAttachments";

// メモと一緒に送られてきた添付ファイルを確かめる。自分たちのVercel Blobの
// 社内メモ用の場所にあるファイルだけを受け付ける（任意のURLを保存させない）。
export function validateNoteAttachments(inputs: NoteAttachmentInput[] | undefined): NoteAttachmentInput[] {
  const list = inputs ?? [];
  if (list.length > MAX_NOTE_ATTACHMENTS) throw new Error("too_many_attachments");
  return list.map((a) => {
    let url: URL;
    try {
      url = new URL(a.url);
    } catch {
      throw new Error("invalid_attachment");
    }
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".blob.vercel-storage.com") ||
      !url.pathname.startsWith(`/${NOTE_ATTACHMENT_PATH_PREFIX}`)
    ) {
      throw new Error("invalid_attachment");
    }
    if (!(NOTE_ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(a.contentType)) throw new Error("invalid_attachment");
    if (!Number.isFinite(a.size) || a.size <= 0 || a.size > MAX_NOTE_ATTACHMENT_BYTES) throw new Error("invalid_attachment");
    const fileName = (a.fileName || "ファイル").slice(0, 200);
    return { url: url.toString(), fileName, contentType: a.contentType, size: Math.round(a.size) };
  });
}

// メモを消したら、添付ファイルの実体も消す（失敗してもメモの削除は取り消さない）
export async function deleteNoteAttachmentFiles(urls: string[]) {
  if (urls.length === 0 || !process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await del(urls);
  } catch (err) {
    console.error("note attachment delete failed", err);
  }
}
