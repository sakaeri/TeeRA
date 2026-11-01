import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { verifySession, getActiveMembership } from "@/lib/auth/session";
import {
  MAX_NOTE_ATTACHMENT_BYTES,
  NOTE_ATTACHMENT_CONTENT_TYPES,
  NOTE_ATTACHMENT_PATH_PREFIX,
} from "@/lib/noteAttachments";

// 社内メモの添付ファイルは、ブラウザから直接Vercel Blobへ送る（サーバーを
// 通すと4.5MBまでしか送れないため）。ここではログインしている会社の
// メンバーにだけ、画像・PDF・10MBまでに限ったアップロードの許可を出す。
// どのメモに付けるかの権限は、メモを保存するときに確かめる。
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const { userId } = await verifySession();
        const membership = await getActiveMembership(userId);
        if (!membership) throw new Error("forbidden");
        if (!pathname.startsWith(NOTE_ATTACHMENT_PATH_PREFIX)) throw new Error("invalid_path");
        return {
          allowedContentTypes: [...NOTE_ATTACHMENT_CONTENT_TYPES],
          maximumSizeInBytes: MAX_NOTE_ATTACHMENT_BYTES,
          addRandomSuffix: true,
        };
      },
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "upload_failed" }, { status: 400 });
  }
}
