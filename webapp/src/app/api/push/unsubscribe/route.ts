import { verifySession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const { userId } = await verifySession();
  const body = await request.json().catch(() => null);
  const endpoint = body?.endpoint as string | undefined;
  if (!endpoint) return new Response("invalid request", { status: 400 });

  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });

  return new Response(null, { status: 204 });
}
