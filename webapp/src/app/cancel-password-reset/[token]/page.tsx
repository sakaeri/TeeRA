import { CancelPasswordResetForm } from "@/components/auth/CancelPasswordResetForm";

// メールの「再設定を取り消す」リンクの行き先。メールの安全確認機能がリンクを
// 自動で開いても取り消されないよう、ボタンを押したときだけ取り消す。
export default async function CancelPasswordResetPage({ params }: PageProps<"/cancel-password-reset/[token]">) {
  const { token } = await params;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 text-center font-serif-jp text-2xl font-bold text-primary">TeeRA</div>
      <div className="rounded-2xl border border-border bg-white/60 p-6">
        <h1 className="mb-6 text-center text-lg font-semibold">パスワード再設定の取り消し</h1>
        <CancelPasswordResetForm token={token} />
      </div>
    </main>
  );
}
