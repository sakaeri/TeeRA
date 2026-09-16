"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManage } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { approveWorkReport, rejectWorkReport, correctAndReturnWorkReport, resolveApproverCompanyId } from "@/lib/domain/workReports";

async function assertCanApprove(workReportId: string, companyId: string, teamId: string | null) {
  const report = await prisma.workReport.findUniqueOrThrow({
    where: { id: workReportId },
    include: { shift: true },
  });
  const approverCompanyId = await resolveApproverCompanyId(report.shiftId);
  if (approverCompanyId !== companyId) throw new Error("forbidden");
  return report;
}

// Next.jsは本番ビルドでServer Actionから素通しで投げた例外のmessageを
// 握りつぶしてしまう（セキュリティ上の既定動作）ため、ここで必ず捕まえて
// {status:"error"}として返す。これをせず投げっぱなしにすると、レース
// 条件（例: 別の管理者が既に処理した後の古い画面から操作した等）で
// エラー画面がそのまま表示されてしまう。
const WORKREPORT_ERROR_LABEL: Record<string, string> = {
  forbidden: "権限がありません",
  not_pending_confirmation: "この業務報告は確認待ちの状態ではありません",
};

export async function approveWorkReportAction(workReportId: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  try {
    const report = await assertCanApprove(workReportId, membership.companyId, null);
    if (!canManage(membership, report.shift.teamId)) throw new Error("forbidden");

    await approveWorkReport({ workReportId, approverUserId: userId });
    revalidatePath("/company/settings");
    revalidatePath("/company");
    return { status: "ok" as const };
  } catch (error) {
    if (error instanceof Error) {
      return { status: "error" as const, reason: WORKREPORT_ERROR_LABEL[error.message] ?? "処理に失敗しました" };
    }
    throw error;
  }
}

export async function rejectWorkReportAction(workReportId: string, reason: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  try {
    const report = await assertCanApprove(workReportId, membership.companyId, null);
    if (!canManage(membership, report.shift.teamId)) throw new Error("forbidden");

    await rejectWorkReport({ workReportId, approverUserId: userId, reason });
    revalidatePath("/company/settings");
    revalidatePath("/company");
    return { status: "ok" as const };
  } catch (error) {
    if (error instanceof Error) {
      return { status: "error" as const, reason: WORKREPORT_ERROR_LABEL[error.message] ?? "処理に失敗しました" };
    }
    throw error;
  }
}

// 差し戻し時に打刻・休憩時間を手修正する。企業側からは直接APPROVEDに
// できない — NEEDS_CONFIRMATIONに置き、スタッフの確認を経て初めて
// 確定する（workReports.ts の correctAndReturnWorkReport 参照）。
export async function correctWorkReportAction(input: {
  workReportId: string;
  clockIn: string; // "HH:MM"
  clockOut: string; // "HH:MM"
  breakMinutes: number;
}) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  try {
    const report = await assertCanApprove(input.workReportId, membership.companyId, null);
    if (!canManage(membership, report.shift.teamId)) throw new Error("forbidden");

    // 打刻時刻はJSTの壁時計として入力される（このアプリの日付/時刻はすべて
    // JST前提）。+09:00オフセットを明示してUTCのDateインスタンスに変換する。
    const day = report.shift.date.toISOString().slice(0, 10);
    await correctAndReturnWorkReport({
      workReportId: input.workReportId,
      correctedByUserId: userId,
      clockIn: new Date(`${day}T${input.clockIn}:00.000+09:00`),
      clockOut: new Date(`${day}T${input.clockOut}:00.000+09:00`),
      breakMinutes: input.breakMinutes,
    });
    revalidatePath("/company/settings");
    revalidatePath("/company");
    return { status: "ok" as const };
  } catch (error) {
    if (error instanceof Error) {
      return { status: "error" as const, reason: WORKREPORT_ERROR_LABEL[error.message] ?? "処理に失敗しました" };
    }
    throw error;
  }
}
