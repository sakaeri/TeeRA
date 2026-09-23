"use server";

import { consumeApproveWorkReportToken } from "@/lib/domain/emailNotifications";

export async function approveWorkReportByTokenAction(token: string) {
  try {
    await consumeApproveWorkReportToken(token);
    return { status: "ok" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "invalid_or_expired_token" || message === "not_pending") {
      return { status: "error" as const, reason: message };
    }
    return { status: "error" as const, reason: "unknown" };
  }
}
