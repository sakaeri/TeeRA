import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { consumeMagicLinkForSignIn, consumeVerifiedPasswordStep } from "@/lib/domain/accountSecurity";

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    // マジックリンク経由のログイン・登録確認専用。トークン自体の検証・
    // 消費（使い捨て化）はconsumeMagicLinkForSignIn内で行う — ここで
    // userIdのような「検証済み」前提の値を直接信頼する実装にすると、
    // /api/auth/callback/magic-linkへ誰でも直接POSTしてなりすませて
    // しまうため、必ず生のトークンを受け取って検証する。
    Credentials({
      id: "magic-link",
      credentials: {
        token: { label: "Token", type: "text" },
      },
      authorize: async (credentials) => {
        const token = credentials?.token;
        if (typeof token !== "string" || !token) return null;

        try {
          const user = await consumeMagicLinkForSignIn(token);
          return { id: user.id, email: user.email, name: user.name };
        } catch {
          return null;
        }
      },
    }),
    // パスワードを設定している人の2段階目（メールのリンク→パスワード）。
    // パスワードの確認はverifyPasswordStepで済ませてあり、ここでは確認済みの
    // トークンだけを受け付けて使い切る（メールアドレスとパスワードだけで
    // ログインする入口はもう無い）。
    Credentials({
      id: "password-step",
      credentials: {
        token: { label: "Token", type: "text" },
      },
      authorize: async (credentials) => {
        const token = credentials?.token;
        if (typeof token !== "string" || !token) return null;

        try {
          const user = await consumeVerifiedPasswordStep(token);
          return { id: user.id, email: user.email, name: user.name };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    // ログインした時点のsessionVersionを覚えておき、以降は毎回DBと比べる。
    // 「すべての端末からログアウト」やパスワード変更で番号が進んでいたら
    // セッションを無効にする（nullを返すとログアウト扱いになる）。
    jwt: async ({ token, user }) => {
      if (user?.id) {
        token.userId = user.id;
      }
      if (typeof token.userId !== "string") return token;
      const current = await prisma.user.findUnique({
        where: { id: token.userId },
        select: { sessionVersion: true },
      });
      if (!current) return null;
      // ログイン直後は今の番号を覚える。それ以外で番号を合わせ直す道は作らない
      // （古い端末が自分で番号を更新して締め出しをすり抜けられないように）
      if (user?.id) {
        token.sessionVersion = current.sessionVersion;
        return token;
      }
      // 以前からログインしている端末（番号を持っていない）は0とみなす
      const remembered = typeof token.sessionVersion === "number" ? token.sessionVersion : 0;
      if (remembered !== current.sessionVersion) return null;
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user && typeof token.userId === "string") {
        session.user.id = token.userId;
      }
      return session;
    },
  },
});
