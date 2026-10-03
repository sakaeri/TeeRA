import "server-only";
import webpush from "web-push";
import { prisma } from "@/lib/prisma";

// VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEYが未設定の間（ローカル開発・CI環境など）
// は実際には送信せず、コンソールに出すだけにする（src/lib/email.tsの
// RESEND_API_KEY未設定時の扱いと同じ考え方）。本番で実際に届けるには、
// VAPID鍵ペアをVercelの環境変数に設定すること。
const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || "mailto:support@example.com";
const configured = Boolean(publicKey && privateKey);

if (configured) {
  webpush.setVapidDetails(subject, publicKey!, privateKey!);
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

async function sendToSubscription(sub: { id: string; endpoint: string; p256dh: string; auth: string }, payload: PushPayload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
    );
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      // 購読が失効している（ブラウザ側で解除された等）— 以後の送信を
      // 無駄にしないため、この端末の購読行を削除しておく。
      await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
    } else {
      console.error(`[push:error] endpoint=${sub.endpoint}`, err);
    }
  }
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload) {
  if (userIds.length === 0) return;
  if (!configured) {
    console.log(`[push:fallback] VAPID鍵未設定のため送信をスキップしました。宛先userId=${userIds.join(",")} 件名=${payload.title}`);
    return;
  }
  const subs = await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
  await Promise.all(subs.map((sub) => sendToSubscription(sub, payload)));
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  await sendPushToUsers([userId], payload);
}
