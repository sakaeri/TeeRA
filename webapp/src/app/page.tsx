import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function LandingPage() {
  const session = await auth();
  if (session?.user?.id) {
    redirect("/home");
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <div className="font-serif-jp text-4xl font-bold text-primary">TeeRA</div>
      <p className="max-w-sm text-sm text-muted">
        シフト管理・業務報告・給与計算・請求書発行までをひとつにまとめる、
        企業とスタッフのためのシフト管理プラットフォーム。
      </p>
      <div className="flex gap-3">
        <Link
          href="/login"
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          ログイン
        </Link>
        <Link
          href="/register"
          className="rounded-lg border border-border px-5 py-2.5 text-sm font-semibold text-foreground"
        >
          新規登録
        </Link>
      </div>
    </main>
  );
}
