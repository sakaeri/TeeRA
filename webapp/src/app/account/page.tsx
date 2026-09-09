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
    <main className="mx-auto w-full max-w-2xl px-8 py-10">
      <Link href={backHref} className="mb-6 inline-block text-sm text-primary underline">
        ← 戻る
      </Link>
      <AccountView userName={user.name} userEmail={user.email} emailChangeNotice={emailChangeNotice} />
    </main>
  );
}
