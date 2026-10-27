import { NextResponse } from "next/server";
import { auth } from "@/auth";

const PUBLIC_ROUTES = ["/", "/login", "/register", "/forgot-password"];
const PUBLIC_PREFIXES = ["/invite/", "/reset-password/", "/confirm-email-change/", "/email-actions/", "/magic-link/"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic =
    PUBLIC_ROUTES.includes(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const isAuthed = Boolean(req.auth?.user);

  if (!isAuthed && !isPublic) {
    const loginUrl = new URL("/login", req.nextUrl);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthed && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/home", req.nextUrl));
  }

  return NextResponse.next();
});

// 公開しているファイル（画像・sw.jsなど）はログインしていなくても取れるようにする。
// sw.jsが転送されるとブラウザが登録を断るため、未ログインのLPで電波が弱いときの
// 表示（public/sw.js）が効かなくなる。
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icon.png|icon-192.png|apple-icon.png|logo-64.png|sw.js|manifest.webmanifest|lp/|howto/).*)",
  ],
};
