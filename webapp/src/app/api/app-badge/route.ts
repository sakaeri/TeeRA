import { auth } from "@/auth";
import { computeAppBadgeCount } from "@/lib/domain/appBadge";

// アプリのアイコンの数字（ログイン中の本人の分）。画面と、プッシュ通知を受けた
// service worker（public/sw.js）から呼ばれる。
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ count: 0 }, { status: 401 });
  const count = await computeAppBadgeCount(userId);
  return Response.json({ count }, { headers: { "Cache-Control": "no-store" } });
}
