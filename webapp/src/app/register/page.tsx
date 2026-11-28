import { RegisterForm } from "@/components/auth/RegisterForm";

export default async function RegisterPage({
  searchParams,
}: PageProps<"/register">) {
  const params = await searchParams;
  const inviteToken =
    typeof params.invite === "string" ? params.invite : undefined;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 text-center font-serif-jp text-2xl font-bold text-primary">
        TeeRA
      </div>
      <div className="rounded-2xl border border-border bg-white/60 p-6">
        <h1 className="mb-6 text-center text-lg font-semibold">
          アカウントを作成
        </h1>
        {inviteToken ? null : (
          <p className="-mt-3 mb-5 rounded-lg bg-accent/10 px-3 py-2 text-xs text-foreground/80" data-testid="register-staff-note">
            スタッフとして働く方は、ここではなく、所属先の会社から届いた招待URLから登録してください。
          </p>
        )}
        <RegisterForm inviteToken={inviteToken} />
      </div>
    </main>
  );
}
