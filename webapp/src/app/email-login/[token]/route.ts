import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { findEmailLoginToken, peekEmailLoginRedirect } from "@/lib/domain/accountSecurity";

// お知らせメールのボタン。宛先本人としてログインして、目的の画面を開く（24時間有効）。
// signIn()はCookieを書き換えるのでRoute Handlerで行う（magic-linkと同じ理由）。
// ・すでにログインしているなら、そのまま目的の画面へ（ほかの人のアカウントに切り替えはしない）
// ・鍵が期限切れ・無効なら、ログイン画面へ（ログイン後に目的の画面へ戻る）
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await auth();
  const found = await findEmailLoginToken(token);

  if (!found) {
    const path = await peekEmailLoginRedirect(token);
    if (session?.user?.id && path) redirect(path);
    redirect(path ? `/login?from=${encodeURIComponent(path)}` : "/login");
  }
  if (session?.user?.id) redirect(found.redirectTo);

  let ok = true;
  try {
    await signIn("email-link", { token, redirect: false });
  } catch {
    ok = false;
  }
  redirect(ok ? found.redirectTo : `/login?from=${encodeURIComponent(found.redirectTo)}`);
}
