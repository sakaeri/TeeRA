import { confirmMagicLinkAction } from "@/app/actions/auth";

// signIn()はCookieを書き換えるため、Server Component（ページ）のレンダー中
// からは直接呼べず（"Cookies can only be modified in a Server Action or
// Route Handler"）、Route Handlerとして実装する。confirmMagicLinkAction自体
// はredirect()で完結する（通常はこのGETが応答を返すことはない）。
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  await confirmMagicLinkAction(token);
}
