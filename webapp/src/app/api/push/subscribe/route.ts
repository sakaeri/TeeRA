import { verifySession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const { userId } = await verifySession();
  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint as string | undefined;
  const p256dh = body?.keys?.p256dh as string | undefined;
  const auth = body?.keys?.auth as string | undefined;
  if (!endpoint || !p256dh || !auth) return new Response("invalid subscription", { status: 400 });

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId, endpoint, p256dh, auth },
    // 他ユーザーが使っていた同一端末での買い替え/ログイン切り替え等で
    // endpointが使い回された場合に備え、持ち主を上書きする。
    update: { userId, p256dh, auth },
  });

  return new Response(null, { status: 204 });
}
