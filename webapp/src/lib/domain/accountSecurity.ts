import "server-only";
import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail, sendEmailChangeConfirmation } from "@/lib/email";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1時間

function generateToken() {
  return randomBytes(24).toString("base64url");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function absoluteUrl(path: string) {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${base}${path}`;
}

// メールアドレスの存在有無を外部に漏らさないため、ユーザーが見つからない
// 場合も何もせず正常終了する（呼び出し側は常に同じ案内文を表示する）。
export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) return;

  const token = generateToken();
  await prisma.accountActionToken.create({
    data: {
      tokenHash: hashToken(token),
      kind: "PASSWORD_RESET",
      userId: user.id,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  await sendPasswordResetEmail(user.email, absoluteUrl(`/reset-password/${token}`));
}

async function consumeToken(token: string, kind: "PASSWORD_RESET" | "EMAIL_CHANGE") {
  const record = await prisma.accountActionToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.kind !== kind || record.usedAt || record.expiresAt < new Date()) {
    throw new Error("invalid_or_expired_token");
  }
  return record;
}

export async function resetPassword(token: string, newPassword: string) {
  const record = await consumeToken(token, "PASSWORD_RESET");
  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.accountActionToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw new Error("incorrect_current_password");

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

export async function requestEmailChange(userId: string, newEmail: string, currentPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw new Error("incorrect_current_password");

  const normalizedEmail = newEmail.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) throw new Error("email_already_in_use");

  const token = generateToken();
  await prisma.accountActionToken.create({
    data: {
      tokenHash: hashToken(token),
      kind: "EMAIL_CHANGE",
      userId,
      newEmail: normalizedEmail,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  await sendEmailChangeConfirmation(normalizedEmail, absoluteUrl(`/confirm-email-change/${token}`));
}

export async function confirmEmailChange(token: string) {
  const record = await consumeToken(token, "EMAIL_CHANGE");
  if (!record.newEmail) throw new Error("invalid_or_expired_token");

  // 発行から確定までの間に別の人がそのアドレスで登録している可能性がある
  // ため、確定直前にもう一度重複チェックする。
  const existing = await prisma.user.findUnique({ where: { email: record.newEmail } });
  if (existing) throw new Error("email_already_in_use");

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { email: record.newEmail } }),
    prisma.accountActionToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
}
