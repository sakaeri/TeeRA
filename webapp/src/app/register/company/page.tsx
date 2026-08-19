import { redirect } from "next/navigation";
import { verifySession, getActiveMembership } from "@/lib/auth/session";
import { CreateCompanyForm } from "@/components/auth/CreateCompanyForm";

export default async function CreateCompanyPage() {
  const { userId } = await verifySession();
  const membership = await getActiveMembership(userId);
  if (membership) {
    redirect("/home");
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 text-center font-serif-jp text-2xl font-bold text-primary">
        TeeRA
      </div>
      <div className="rounded-2xl border border-border bg-white/60 p-6">
        <h1 className="mb-2 text-center text-lg font-semibold">
          まだ本部がありません
        </h1>
        <p className="mb-6 text-center text-sm text-muted">
          本部名を入力して、新しい本部を作成してください。
          <br />
          スタッフとして参加する場合は、所属先から届く招待URLからご登録ください。
        </p>
        <CreateCompanyForm />
      </div>
    </main>
  );
}
