import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { consumeMagicLinkForSignIn } from "@/lib/domain/accountSecurity";

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      id: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase().trim() },
        });
        // パスワード未設定（マジックリンクのみ）のアカウントはここでは
        // ログインできない — bcrypt.compareにnullを渡すとエラーになるため
        // 先に弾く。
        if (!user || !user.passwordHash) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
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
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user?.id) {
        token.userId = user.id;
      }
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
