// 社内メモの添付ファイル（画像・PDF）の決まりごと。画面（ブラウザ）とサーバーの両方から使う。
export const MAX_NOTE_ATTACHMENTS = 5;
export const MAX_NOTE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const NOTE_ATTACHMENT_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "application/pdf",
] as const;
// Vercel Blobに置くときのパス（先頭）。サーバー側はこの場所のファイルしか受け付けない
export const NOTE_ATTACHMENT_PATH_PREFIX = "note-attachments/";

// アップロードし終わって、メモと一緒に保存するファイル
export type NoteAttachmentInput = {
  url: string;
  fileName: string;
  contentType: string;
  size: number;
};

// 画面に出すときの形。実体のURLは渡さず、権限を確かめて返す /api/note-attachments/[id] を使う
export type NoteAttachmentView = {
  id: string;
  fileName: string;
  isPdf: boolean;
  href: string;
};

export function noteAttachmentView(a: { id: string; fileName: string; contentType: string }): NoteAttachmentView {
  return {
    id: a.id,
    fileName: a.fileName,
    isPdf: a.contentType === "application/pdf",
    href: `/api/note-attachments/${a.id}`,
  };
}
