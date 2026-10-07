import { redirect } from "next/navigation";
import { verifySession, getActiveMembership } from "@/lib/auth/session";
import { CreateCompanyForm } from "@/components/auth/CreateCompanyForm";
import { logoutAction } from "@/app/actions/auth";

export default async function CreateCompanyPage({
  searchParams,
}: PageProps<"/register/company">) {
  const { userId } = await verifySession();
  const membership = await getActiveMembership(userId);
  const sp = await searchParams;
  const inviteToken = typeof sp.invite === "string" && sp.invite ? sp.invite : undefined;
  if (membership) {
    redirect(inviteToken ? `/invite/${inviteToken}` : "/home");
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 text-center font-serif-jp text-2xl font-bold text-primary">
        TeeRA
      </div>
      <div className="rounded-2xl border border-border bg-white/60 p-6">
        <h1 className="mb-2 text-lg font-semibold">
          {inviteToken ? "まだ事業所がありません" : "シフト管理する事業所の登録をお願いします"}
        </h1>
        <p className="mb-6 text-sm text-muted">
          {inviteToken ? (
            <>取引先からの招待を受け取るには、まず事業所を作成してください。</>
          ) : (
            <>
              事業所名を入力してください。
              スタッフとして参加する場合は、所属先から届く招待URLからご登録ください。
            </>
          )}
        </p>
        <CreateCompanyForm inviteToken={inviteToken} />
      </div>
      <form action={logoutAction} className="mt-4">
        <button type="submit" className="w-full text-center text-sm text-muted hover:text-foreground">
          別のアカウントでログインし直す（ログアウト）
        </button>
      </form>
    </main>
  );
}
