import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export default async function ResetPasswordPage({
  params,
}: PageProps<"/reset-password/[token]">) {
  const { token } = await params;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 text-center font-serif-jp text-2xl font-bold text-primary">
        TeeRA
      </div>
      <div className="rounded-2xl border border-border bg-white/60 p-6">
        <h1 className="mb-6 text-center text-lg font-semibold">新しいパスワードの設定</h1>
        <ResetPasswordForm token={token} />
      </div>
    </main>
  );
}
