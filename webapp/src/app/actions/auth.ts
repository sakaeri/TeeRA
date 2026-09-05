"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  RegisterSchema,
  LoginSchema,
  CreateCompanySchema,
} from "@/lib/validation/auth";
import { verifySession, getActiveMembership, ACTIVE_COMPANY_COOKIE } from "@/lib/auth/session";
import { redeemInvite, lookupInvite, redeemCompanyRelationshipInvite } from "@/lib/domain/invites";

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
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { errors: z_flatten(parsed) };
  }

  const { name, email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });
  if (existing) {
    return { errors: { email: ["このメールアドレスは既に登録されています。"] } };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: { name, email: normalizedEmail, passwordHash },
  });

  await signIn("credentials", {
    email: normalizedEmail,
    password,
    redirect: false,
  });

  const inviteToken = formData.get("inviteToken");
  if (typeof inviteToken === "string" && inviteToken.length > 0) {
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

  redirect("/register/company");
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

  const company = await prisma.company.create({
    data: { name: parsed.data.name },
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
