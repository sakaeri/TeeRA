"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  RegisterSchema,
  LoginSchema,
  CreateCompanySchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  RequestMagicLinkSchema,
} from "@/lib/validation/auth";
import { verifySession, getActiveMembership, ACTIVE_COMPANY_COOKIE } from "@/lib/auth/session";
import { redeemInvite, lookupInvite, redeemCompanyRelationshipInvite } from "@/lib/domain/invites";
import {
  requestPasswordReset,
  resetPassword,
  registerPendingUser,
  sendRegistrationMagicLink,
  sendLoginMagicLink,
  peekMagicLinkToken,
} from "@/lib/domain/accountSecurity";

export type FormState =
  | { errors?: Record<string, string[]>; message?: string }
  | undefined;

export async function registerAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = RegisterSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { errors: z_flatten(parsed) };
  }

  const inviteTokenRaw = formData.get("inviteToken");
  const inviteToken = typeof inviteTokenRaw === "string" && inviteTokenRaw.length > 0 ? inviteTokenRaw : undefined;

  let user;
  try {
    user = await registerPendingUser(parsed.data);
  } catch (error) {
    if (error instanceof Error && error.message === "email_already_registered") {
      return { errors: { email: ["このメールアドレスは既に登録されています。"] } };
    }
    throw error;
  }

  await sendRegistrationMagicLink(user.id, inviteToken);
  return { message: "sent" };
}

// マジックリンク確認ページから呼ばれる（新規登録の確認・パスワードレス
// ログインの両方で共通）。トークンを検証してログイン状態にした上で、
// 招待経由の登録だった場合は元の招待フローへ、それ以外は本人の所属状況
// から行き先を判断する（会社未所属＝新規登録なら会社作成画面、既に
// 所属済み＝ただのログインなら/homeへ、という形で用途を区別する）。
export async function confirmMagicLinkAction(token: string) {
  const peeked = await peekMagicLinkToken(token);
  if (!peeked) {
    redirect("/login?magicLink=error");
  }
  const { userId, inviteToken, redirectTo } = peeked;

  try {
    await signIn("magic-link", { token, redirect: false });
  } catch {
    redirect("/login?magicLink=error");
  }

  if (redirectTo) {
    redirect(redirectTo);
  }

  if (inviteToken) {
    // CLIENT_UPGRADE/AGENCY_UPGRADE招待は会社同士を結びつけるものなので、
    // 受け取る側にも自社が必要 — 先に会社登録へ回し、完了後にこの招待へ戻す。
    const lookup = await lookupInvite(inviteToken);
    if (
      lookup.status === "valid" &&
      (lookup.invite.kind === "CLIENT_UPGRADE" || lookup.invite.kind === "AGENCY_UPGRADE")
    ) {
      redirect(`/register/company?invite=${inviteToken}`);
    }
    redirect(`/invite/${inviteToken}`);
  }

  const existingMembership = await prisma.companyMembership.findFirst({ where: { userId } });
  redirect(existingMembership ? "/home" : "/register/company");
}

// ログイン画面の「メールでログインリンクを受け取る」用。メールアドレスの
// 存在有無・パスワード設定有無を外に漏らさないため、常に同じ成功表示を
// 返す（中でパスワード設定済みなら実際にはリンクを送らない）。
export async function requestLoginMagicLinkAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = RequestMagicLinkSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { errors: z_flatten(parsed) };
  }

  const from = formData.get("from");
  await sendLoginMagicLink(parsed.data.email, typeof from === "string" && from.length > 0 ? from : undefined);
  return { message: "sent" };
}

export async function loginAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { errors: z_flatten(parsed) };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email.toLowerCase(),
      password: parsed.data.password,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { message: "メールアドレスまたはパスワードが正しくありません。" };
    }
    throw error;
  }

  const from = formData.get("from");
  redirect(typeof from === "string" && from.length > 0 ? from : "/home");
}

export async function logoutAction() {
  await signOut({ redirect: false });
  redirect("/login");
}

// メールアドレスの存在有無を外部に漏らさないため、見つかった/見つからない
// どちらでも同じ成功メッセージを返す（呼び出し元のフォームはこの結果を
// 常に「送信しました」として表示する）。
export async function requestPasswordResetAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = ForgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { errors: z_flatten(parsed) };
  }

  await requestPasswordReset(parsed.data.email);
  return { message: "sent" };
}

export async function resetPasswordAction(
  token: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = ResetPasswordSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    return { errors: z_flatten(parsed) };
  }

  try {
    await resetPassword(token, parsed.data.password);
  } catch {
    return { message: "invalid_or_expired_token" };
  }

  redirect("/login?reset=1");
}

// 「今どの会社として動いているか」を選び直す（複数社所属時の切替）。
// このuserIdが本当にその会社に所属しているかをDBで確認してからでないと
// Cookieを立てない（改ざん対策というよりは、単純に存在しない/退会済みの
// 会社を指してしまわないための整合性チェック）。
export async function setActiveCompanyAction(companyId: string) {
  const { userId } = await verifySession();
  const membership = await prisma.companyMembership.findFirst({ where: { userId, companyId } });
  if (!membership) throw new Error("forbidden");

  const store = await cookies();
  store.set(ACTIVE_COMPANY_COOKIE, companyId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect(membership.role === "STAFF" ? "/staff" : "/company");
}

export async function createCompanyAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const { userId } = await verifySession();

  const existing = await prisma.companyMembership.findFirst({
    where: { userId },
  });
  if (existing) {
    redirect("/home");
  }

  const parsed = CreateCompanySchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { errors: z_flatten(parsed) };
  }

  // 通知用メールアドレスは作成者のメアドを初期値にしておく（空のままだと
  // アプリの存在に気づく前に通知が一切届かず離脱しやすいため）。あくまで
  // 初期値なので、不要なら設定画面から空に変更できる。
  const creator = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const company = await prisma.company.create({
    data: { name: parsed.data.name, notificationEmail: creator.email },
  });
  await prisma.companyMembership.create({
    data: { userId, companyId: company.id, role: "COMPANY_ADMIN" },
  });

  const inviteToken = formData.get("invite");
  if (typeof inviteToken === "string" && inviteToken.length > 0) {
    redirect(`/invite/${inviteToken}`);
  }

  redirect("/company");
}

export async function redeemInviteAction(token: string) {
  const { userId } = await verifySession();

  try {
    await redeemInvite(token, userId);
  } catch (error) {
    const messageKey = error instanceof Error ? error.message : "unknown";
    redirect(`/invite/${token}?error=${messageKey}`);
  }

  redirect("/home");
}

// CLIENT_UPGRADE / AGENCY_UPGRADE: ログイン中ユーザーが管理者/編集者として
// 所属する自社を、この招待の相手側企業として結びつける。複数社所属時は
// 「今どの会社として動いているか」（アクティブ会社、/invite/[token]/page.tsxの
// 表示と同じ解決方法）を使う — ここだけ別の会社を勝手に選ばないようにする。
export async function redeemCompanyRelationshipInviteAction(token: string) {
  const { userId } = await verifySession();

  const membership = await getActiveMembership(userId);
  if (!membership) {
    redirect(`/register/company?invite=${token}`);
  }
  if (membership.role === "STAFF") {
    redirect(`/invite/${token}?error=requires_admin`);
  }

  try {
    await redeemCompanyRelationshipInvite(token, membership.companyId);
  } catch (error) {
    const messageKey = error instanceof Error ? error.message : "unknown";
    redirect(`/invite/${token}?error=${messageKey}`);
  }

  redirect("/company/roster");
}

function z_flatten(
  parsed: { success: false; error: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } } },
) {
  const flat = parsed.error.flatten().fieldErrors;
  const out: Record<string, string[]> = {};
  for (const key of Object.keys(flat)) {
    const value = flat[key];
    if (value) out[key] = value;
  }
  return out;
}
