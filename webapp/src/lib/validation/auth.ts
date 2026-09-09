import * as z from "zod";

export const RegisterSchema = z.object({
  name: z.string().trim().min(1, { error: "氏名を入力してください。" }),
  email: z.email({ error: "有効なメールアドレスを入力してください。" }).trim(),
  password: z
    .string()
    .min(8, { error: "8文字以上で入力してください。" })
    .regex(/[a-zA-Z]/, { error: "英字を1文字以上含めてください。" })
    .regex(/[0-9]/, { error: "数字を1文字以上含めてください。" }),
});

export const LoginSchema = z.object({
  email: z.email({ error: "有効なメールアドレスを入力してください。" }).trim(),
  password: z.string().min(1, { error: "パスワードを入力してください。" }),
});

export const CreateCompanySchema = z.object({
  name: z.string().trim().min(1, { error: "本部名を入力してください。" }),
});

export const ProfileUpdateSchema = z.object({
  name: z.string().trim().min(1, { error: "氏名を入力してください。" }),
  email: z.email({ error: "有効なメールアドレスを入力してください。" }).trim(),
  password: z
    .string()
    .min(8, { error: "8文字以上で入力してください。" })
    .optional()
    .or(z.literal("")),
});

const NEW_PASSWORD_SCHEMA = z
  .string()
  .min(8, { error: "8文字以上で入力してください。" })
  .regex(/[a-zA-Z]/, { error: "英字を1文字以上含めてください。" })
  .regex(/[0-9]/, { error: "数字を1文字以上含めてください。" });

export const ForgotPasswordSchema = z.object({
  email: z.email({ error: "有効なメールアドレスを入力してください。" }).trim(),
});

export const ResetPasswordSchema = z.object({
  password: NEW_PASSWORD_SCHEMA,
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, { error: "現在のパスワードを入力してください。" }),
  newPassword: NEW_PASSWORD_SCHEMA,
});

export const ChangeEmailSchema = z.object({
  newEmail: z.email({ error: "有効なメールアドレスを入力してください。" }).trim(),
  currentPassword: z.string().min(1, { error: "現在のパスワードを入力してください。" }),
});
