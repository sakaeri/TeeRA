import { peekPasswordStep } from "@/lib/domain/accountSecurity";
import { PasswordStepExpired, PasswordStepForm } from "@/components/auth/PasswordStepForm";

export default async function LoginPasswordStepPage({ params }: PageProps<"/login/password/[token]">) {
  const { token } = await params;
  const step = await peekPasswordStep(token);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 text-center font-serif-jp text-2xl font-bold text-primary">TeeRA</div>
      <div className="rounded-2xl border border-border bg-white/60 p-6">
        <h1 className="mb-6 text-center text-lg font-semibold">パスワードの入力</h1>
        {step ? <PasswordStepForm token={token} /> : <PasswordStepExpired />}
      </div>
    </main>
  );
}
