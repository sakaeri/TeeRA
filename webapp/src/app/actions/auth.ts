"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  RegisterSchema,
  LoginSchema,
  CreateCompanySchema,
} from "@/lib/validation/auth";
import { verifySession } from "@/lib/auth/session";
import { redeemInvite } from "@/lib/domain/invites";

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
