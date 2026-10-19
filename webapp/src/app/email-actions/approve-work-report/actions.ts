"use server";

import { consumeApproveWorkReportToken } from "@/lib/domain/emailNotifications";
import { getCurrentUser } from "@/lib/auth/session";

export async function approveWorkReportByTokenAction(token: string) {
  try {
    // ログイン中なら承認者として記録する（メールのリンクはログイン不要）
    const viewer = await getCurrentUser();
    await consumeApproveWorkReportToken(token, viewer?.id);
    return { status: "ok" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "invalid_or_expired_token" || message === "not_pending") {
      return { status: "error" as const, reason: message };
    }
    return { status: "error" as const, reason: "unknown" };
  }
}
