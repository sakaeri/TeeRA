import Link from "next/link";
import { verifySession, getActiveMembership } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AccountView } from "@/components/account/AccountView";

export default async function AccountPage({
  searchParams,
}: PageProps<"/account">) {
  const { userId } = await verifySession();
  const [user, membership] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    getActiveMembership(userId),
  ]);
  const sp = await searchParams;
  const emailChangeNotice =
    sp.emailChange === "success" || sp.emailChange === "error" ? sp.emailChange : undefined;
  const backHref = membership?.role === "STAFF" ? "/staff" : "/company";

  return (
    // ホーム画面に追加したアプリ（全画面表示）では上端が時計・電池の帯と重なるので、その分下げる
    <main className="mx-auto w-full max-w-2xl px-4 pb-10 pt-[calc(1.5rem+env(safe-area-inset-top))] sm:px-8 sm:pt-10">
      <Link href={backHref} className="mb-6 inline-block py-2 text-sm text-primary underline">
        ← 戻る
      </Link>
      <AccountView
        userName={user.name}
        userEmail={user.email}
        hasPassword={user.passwordHash !== null}
        emailChangeNotice={emailChangeNotice}
        pendingPasswordEffectiveAt={
          user.pendingPasswordEffectiveAt && user.pendingPasswordEffectiveAt > new Date()
            ? new Intl.DateTimeFormat("ja-JP", {
                timeZone: "Asia/Tokyo",
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }).format(user.pendingPasswordEffectiveAt)
            : undefined
        }
      />
    </main>
  );
}
