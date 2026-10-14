import "server-only";
import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  sendPasswordResetEmail,
  sendEmailChangeConfirmation,
  sendRegistrationConfirmEmail,
  sendLoginMagicLinkEmail,
  sendPasswordRequiredNoticeEmail,
} from "@/lib/email";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1時間（パスワードリセット・メール変更確認）
const MAGIC_LINK_TTL_MS = 24 * 60 * 60 * 1000; // 24時間（登録確認・ログイン用リンクはすぐ見るとは限らないため長め）
const RESEND_COOLDOWN_MS = 60 * 1000; // 同じ用途への連投防止（嫌がらせメール対策）

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

// 直近RESEND_COOLDOWN_MS以内に同じユーザー・同じ種別宛てに未使用トークンを
// 発行済みなら、新しく送らず既存のものをそのまま使う（連打によるメール
// 連投を防ぐ）。呼び出し側はこの有無に関わらず同じ成功表示をする。
async function wasRecentlySent(userId: string, kind: "PASSWORD_RESET" | "EMAIL_CHANGE" | "MAGIC_LINK") {
  const recent = await prisma.accountActionToken.findFirst({
    where: { userId, kind, usedAt: null, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
  });
  return Boolean(recent);
}

// メールアドレスの存在有無を外部に漏らさないため、ユーザーが見つからない
// 場合も何もせず正常終了する（呼び出し側は常に同じ案内文を表示する）。
export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) return;
  if (await wasRecentlySent(user.id, "PASSWORD_RESET")) return;

  const token = generateToken();
  await prisma.accountActionToken.create({
    data: {
      tokenHash: hashToken(token),
      kind: "PASSWORD_RESET",
      userId: user.id,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  await sendPasswordResetEmail(user.email, user.name, absoluteUrl(`/reset-password/${token}`));
}

async function consumeToken(token: string, kind: "PASSWORD_RESET" | "EMAIL_CHANGE" | "MAGIC_LINK") {
  const record = await prisma.accountActionToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.kind !== kind || record.usedAt || record.expiresAt < new Date()) {
    throw new Error("invalid_or_expired_token");
  }
  return record;
}

export async function resetPassword(token: string, newPassword: string) {
  const record = await consumeToken(token, "PASSWORD_RESET");
  if (!record.userId) throw new Error("invalid_or_expired_token");
  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.accountActionToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.passwordHash) throw new Error("no_password_set");
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw new Error("incorrect_current_password");

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

// パスワード未設定の人が、アカウント設定から初めてパスワードを設定する
// 場合専用 — 照合すべき「現在のパスワード」が存在しないのでchangePassword
// とは別関数にする。既にパスワードがある場合は（画面上は出さない想定だが
// 念のため）弾く。
export async function setInitialPassword(userId: string, newPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.passwordHash) throw new Error("password_already_set");

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

// 設定済みのパスワードを削除し、マジックリンクのみでログインする状態に
// 戻す。本人確認のため現在のパスワードを要求する。
export async function removePassword(userId: string, currentPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.passwordHash) throw new Error("no_password_set");
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw new Error("incorrect_current_password");

  await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
}

export async function requestEmailChange(userId: string, newEmail: string, currentPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.passwordHash) throw new Error("no_password_set");
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw new Error("incorrect_current_password");

  const normalizedEmail = newEmail.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) throw new Error("email_already_in_use");

  if (await wasRecentlySent(userId, "EMAIL_CHANGE")) return;

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

  await sendEmailChangeConfirmation(normalizedEmail, user.name, absoluteUrl(`/confirm-email-change/${token}`));
}

export async function confirmEmailChange(token: string) {
  const record = await consumeToken(token, "EMAIL_CHANGE");
  if (!record.newEmail || !record.userId) throw new Error("invalid_or_expired_token");

  // 発行から確定までの間に別の人がそのアドレスで登録している可能性がある
  // ため、確定直前にもう一度重複チェックする。
  const existing = await prisma.user.findUnique({ where: { email: record.newEmail } });
  if (existing) throw new Error("email_already_in_use");

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { email: record.newEmail } }),
    prisma.accountActionToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
}

// --- マジックリンク（登録確認・パスワードレスログイン） ---------------------

// 新規登録: 名前・メールだけで仮のUserを作り（passwordHash:null、
// emailVerified:false）、確認メールを送る。既に同じメールで「確認待ちの
// まま」のユーザーがいる場合は新規作成せず、そのユーザーへ再送する扱いに
// する（リンクの有効期限切れ・メール見逃しからの再登録を同じ画面で救う）。
// 既に確認済み（emailVerified:true）のメールは通常どおり重複エラーにする。
export async function registerPendingUser(params: { name: string; email: string }) {
  const normalizedEmail = params.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing?.emailVerified) {
    throw new Error("email_already_registered");
  }

  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { name: params.name } })
    : await prisma.user.create({
        data: { name: params.name, email: normalizedEmail, passwordHash: null, emailVerified: false },
      });
  return user;
}

export async function sendRegistrationMagicLink(userId: string, inviteToken?: string) {
  if (await wasRecentlySent(userId, "MAGIC_LINK")) return;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const token = generateToken();
  await prisma.accountActionToken.create({
    data: {
      tokenHash: hashToken(token),
      kind: "MAGIC_LINK",
      userId,
      inviteToken: inviteToken || null,
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
    },
  });

  await sendRegistrationConfirmEmail(user.email, user.name, absoluteUrl(`/magic-link/${token}`));
}

// ログイン用マジックリンクの申請。メールアドレスの存在有無・パスワード
// 設定有無を外部に漏らさないよう、呼び出し側は常に同じ案内文を表示する
// （中でパスワード設定済みの場合は実際にはリンクを送らず、代わりに
// 「パスワードでログインしてください」という案内メールだけ送る）。
export async function sendLoginMagicLink(email: string, redirectTo?: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) return;

  if (user.passwordHash) {
    await sendPasswordRequiredNoticeEmail(user.email, user.name);
    return;
  }

  if (await wasRecentlySent(user.id, "MAGIC_LINK")) return;

  const token = generateToken();
  await prisma.accountActionToken.create({
    data: {
      tokenHash: hashToken(token),
      kind: "MAGIC_LINK",
      userId: user.id,
      redirectTo: redirectTo || null,
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
    },
  });

  await sendLoginMagicLinkEmail(user.email, user.name, absoluteUrl(`/magic-link/${token}`));
}

// auth.tsの"magic-link" Credentialsプロバイダからのみ呼ばれる —
// トークン自体をここで検証・消費する（単なるuserIdの受け渡しにすると
// /api/auth/callback/magic-linkへ誰でも直接POSTしてなりすませてしまう）。
export async function consumeMagicLinkForSignIn(token: string) {
  const record = await consumeToken(token, "MAGIC_LINK");
  if (!record.userId) throw new Error("invalid_or_expired_token");

  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true } }),
    prisma.accountActionToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
  return user;
}

// 確認リンクを踏んだ後の行き先判定（招待フローへ進むか、どのユーザーか）
// に使う。signIn()自体は検証後のユーザー情報を呼び出し元へ返さないため、
// 消費前にトークン行をtokenHashで直接読んで取り出す（実際の検証・消費は
// authorize内のconsumeMagicLinkForSignInが別途行う）。
export async function peekMagicLinkToken(token: string) {
  const record = await prisma.accountActionToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.kind !== "MAGIC_LINK" || !record.userId) return null;
  return { userId: record.userId, inviteToken: record.inviteToken, redirectTo: record.redirectTo };
}
