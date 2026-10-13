import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { LandingNav } from "@/components/LandingNav";

// このページは唯一「未ログインの訪問者に実コンテンツを返す」公開ページ
// のため、Next.jsのビルド時プリレンダー判定に賭けず明示的に動的指定する
// （他の画面はログイン必須でauth()のredirectにしかならずこの問題が
// 表面化しなかった）。
export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const session = await auth();
  if (session?.user?.id) {
    redirect("/home");
  }

  return (
    <main className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2 font-serif-jp text-xl font-bold text-primary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" className="h-8 w-8 rounded-lg" />
          TeeRA
        </div>
        <Link href="/login" className="text-sm font-semibold text-primary hover:underline">
          ログイン
        </Link>
      </header>

      {/* Hero */}
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-6 py-16 text-center sm:py-20">
        <h1 className="font-serif-jp text-3xl font-bold leading-snug text-primary sm:text-4xl">
          シフト管理から給与計算まで、
          <br />
          ひとつのアプリで。
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted sm:text-base">
          シフト作成、タイムカード、業務報告、給与計算、請求書発行までをひとつにまとめた、
          企業とスタッフのためのシフト管理プラットフォームです。基本機能は無料でご利用いただけます。
        </p>
        <Link
          href="/register"
          className="rounded-lg bg-primary px-8 py-3 text-base font-semibold text-primary-foreground shadow-md"
        >
          無料で始める
        </Link>
        <div className="mt-4 w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-white shadow-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/lp/calendar.png" alt="シフトカレンダーの画面" className="w-full" />
        </div>
      </section>

      <LandingNav />

      {/* Footer CTA */}
      <section className="bg-primary px-6 py-16 text-center text-primary-foreground">
        <h2 className="mb-4 font-serif-jp text-2xl font-bold">まずは無料で、始めてみませんか？</h2>
        <Link
          href="/register"
          className="inline-block rounded-lg bg-accent px-8 py-3 text-base font-semibold text-primary shadow-md"
        >
          無料で始める
        </Link>
      </section>

      <footer className="px-6 py-8 text-center text-xs text-muted">
        <div className="mb-2 font-serif-jp text-base font-bold text-primary">TeeRA</div>
        <Link href="/login" className="hover:underline">
          ログイン
        </Link>
      </footer>
    </main>
  );
}
