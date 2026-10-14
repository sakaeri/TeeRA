"use server";

import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/session";
import {
  ChangePasswordSchema,
  ChangeEmailSchema,
  SetInitialPasswordSchema,
  RemovePasswordSchema,
} from "@/lib/validation/auth";
import {
  changePassword,
  requestEmailChange,
  confirmEmailChange,
  setInitialPassword,
  removePassword,
} from "@/lib/domain/accountSecurity";
import type { FormState } from "@/app/actions/auth";

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

export async function changePasswordAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const { userId } = await verifySession();
  const parsed = ChangePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });
  if (!parsed.success) {
    return { errors: z_flatten(parsed) };
  }

  try {
    await changePassword(userId, parsed.data.currentPassword, parsed.data.newPassword);
  } catch {
    return { message: "現在のパスワードが正しくありません。" };
  }

  return { message: "パスワードを変更しました。" };
}

export async function requestEmailChangeAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const { userId } = await verifySession();
  const parsed = ChangeEmailSchema.safeParse({
    newEmail: formData.get("newEmail"),
    currentPassword: formData.get("currentPassword"),
  });
  if (!parsed.success) {
    return { errors: z_flatten(parsed) };
  }

  try {
    await requestEmailChange(userId, parsed.data.newEmail, parsed.data.currentPassword);
  } catch (error) {
    if (error instanceof Error && error.message === "email_already_in_use") {
      return { errors: { newEmail: ["このメールアドレスは既に使用されています。"] } };
    }
    if (error instanceof Error && error.message === "no_password_set") {
      return { message: "メールアドレスを変更するには、先にパスワードを設定してください。" };
    }
    return { message: "現在のパスワードが正しくありません。" };
  }

  return { message: "確認メールを送信しました。新しいアドレス宛のメール内のリンクをクリックすると変更が確定します。" };
}

export async function setInitialPasswordAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const { userId } = await verifySession();
  const parsed = SetInitialPasswordSchema.safeParse({
    newPassword: formData.get("newPassword"),
  });
  if (!parsed.success) {
    return { errors: z_flatten(parsed) };
  }

  try {
    await setInitialPassword(userId, parsed.data.newPassword);
  } catch {
    return { message: "パスワードを設定できませんでした。ページを再読み込みしてお試しください。" };
  }

  return { message: "パスワードを設定しました。" };
}

export async function removePasswordAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const { userId } = await verifySession();
  const parsed = RemovePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
  });
  if (!parsed.success) {
    return { errors: z_flatten(parsed) };
  }

  try {
    await removePassword(userId, parsed.data.currentPassword);
  } catch {
    return { message: "現在のパスワードが正しくありません。" };
  }

  return { message: "パスワードを削除しました。次回からはメールのログイン用リンクでログインできます。" };
}

export async function confirmEmailChangeAction(token: string) {
  try {
    await confirmEmailChange(token);
  } catch {
    redirect("/account?emailChange=error");
  }
  redirect("/account?emailChange=success");
}
