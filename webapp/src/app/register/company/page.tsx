import { redirect } from "next/navigation";
import { verifySession, getActiveMembership } from "@/lib/auth/session";
import { CreateCompanyForm } from "@/components/auth/CreateCompanyForm";
import { logoutAction } from "@/app/actions/auth";
import { StaffOrCompanyChooser } from "@/components/auth/StaffOrCompanyChooser";

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

  const companyCard = (
    <div className="rounded-2xl border border-border bg-white/60 p-6">
      {inviteToken ? null : <p className="mb-1 text-xs font-semibold text-muted">会社としてシフト管理に使う方</p>}
      <h1 className="mb-2 text-lg font-semibold">
        {inviteToken ? "まだ事業所がありません" : "シフト管理する事業所の登録をお願いします"}
      </h1>
      <p className="mb-6 text-sm text-muted">
        {inviteToken ? "取引先からの招待を受け取るには、まず事業所を作成してください。" : "事業所名を入力してください。"}
      </p>
      <CreateCompanyForm inviteToken={inviteToken} />
    </div>
  );

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 text-center font-serif-jp text-2xl font-bold text-primary">
        TeeRA
      </div>
      {/* どこの会社にも入っていない人は、先に「スタッフとして働く方はこちら」を選べる（間違えて会社を作らないように） */}
      {inviteToken ? companyCard : <StaffOrCompanyChooser>{companyCard}</StaffOrCompanyChooser>}
      <form action={logoutAction} className="mt-4">
        <button type="submit" className="w-full text-center text-sm text-muted hover:text-foreground">
          別のアカウントでログインし直す（ログアウト）
        </button>
      </form>
    </main>
  );
}
