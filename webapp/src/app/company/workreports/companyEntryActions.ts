"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManageAny, canManageShifts } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { todayJst } from "@/lib/date";
import { approveWorkReport, resolveApproverCompanyId, submitWorkReport } from "@/lib/domain/workReports";
import { listTaskNamesByWorkplace } from "@/lib/domain/contracts";
import { listClients } from "@/lib/domain/relationships";
import { getStaffTeamIds } from "@/lib/domain/teams";
import { createStaffNotice } from "@/lib/domain/notices";
import { taskNamesForWorkplace } from "@/lib/workplaceTaskNames";
import { AllowanceError, listAllowances, listShiftAllowances, setShiftAllowances, type ShiftAllowanceInput } from "@/lib/domain/allowances";

// スタッフが出していない業務報告を、会社が代わりに入力する（入力と同時に承認済みにする）。
// 仮アカウントのスタッフ・報告し忘れた過去の分を、請求書や給料明細に入れるため。

export type CompanyEntryInput = {
  outcome: "WORKED" | "ABSENT" | "CANCELLED_BY_EMPLOYER";
  clockIn?: string; // HH:MM
  clockOut?: string;
  breakMinutes?: number;
  taskName?: string | null;
  // 手当（帯同手当・チップなど）。undefinedなら変えない（シフトを作る時に付けた手当はそのまま）
  allowances?: ShiftAllowanceInput[];
};

const ENTRY_ERROR_LABEL: Record<string, string> = {
  forbidden: "権限がありません",
  future_date: "これからの勤務は入力できません（勤務した日を過ぎてから入力してください）",
  already_submitted: "スタッフが既に業務報告を出しています",
  clock_in_out_required: "出勤・退勤の時刻を入れてください",
  invalid_time_range: "退勤の時刻が出勤より前になっています",
  invalid_date: "日付を入れてください",
};

const TIME = /^\d{2}:\d{2}$/;

async function enterForShift(shiftId: string, input: CompanyEntryInput, enteredByUserId: string, companyId: string) {
  const shift = await prisma.shift.findUniqueOrThrow({
    where: { id: shiftId },
    include: { workReport: true, staff: { select: { isProxy: true } } },
  });
  if (shift.companyId !== companyId) throw new Error("forbidden");
  if (shift.date.toISOString().slice(0, 10) > todayJst()) throw new Error("future_date");
  if (shift.workReport?.submittedAt) throw new Error("already_submitted");
  if (input.outcome === "WORKED" && (!input.clockIn || !input.clockOut || !TIME.test(input.clockIn) || !TIME.test(input.clockOut))) {
    throw new Error("clock_in_out_required");
  }

  const report = await submitWorkReport({
    shiftId: shift.id,
    staffUserId: shift.staffUserId,
    outcome: input.outcome,
    breakMinutes: input.outcome === "WORKED" ? Math.max(0, Math.round(Number(input.breakMinutes) || 0)) : undefined,
    clockInTime: input.outcome === "WORKED" ? input.clockIn : undefined,
    clockOutTime: input.outcome === "WORKED" ? input.clockOut : undefined,
  });
  // 業務内容は、予定と違う時だけ業務報告に持つ（スタッフの単価に名前だけの行を作らないよう、直接入れる）
  const taskName = input.taskName?.trim() || null;
  await prisma.workReport.update({
    where: { id: report.id },
    data: {
      enteredByCompanyUserId: enteredByUserId,
      ...(input.outcome === "WORKED" ? { taskName: taskName && taskName !== shift.taskName ? taskName : null } : {}),
    },
  });

  if (input.outcome === "WORKED" && Array.isArray(input.allowances)) {
    await setShiftAllowances({ shiftId: shift.id, items: input.allowances, actorUserId: enteredByUserId });
  }

  // 承認する会社が自分の時はそのまま承認済みにする（依頼主が本アカウントの現場は、依頼主の承認を待つ）
  let approved = false;
  if ((await resolveApproverCompanyId(shift.id)) === companyId) {
    await approveWorkReport({ workReportId: report.id, approverUserId: enteredByUserId });
    approved = true;
  }

  if (!shift.staff.isProxy) {
    const [, m, d] = shift.date.toISOString().slice(0, 10).split("-").map(Number);
    await createStaffNotice({
      companyId,
      staffUserId: shift.staffUserId,
      message: `${m}/${d}の業務報告を会社が入力しました`,
    });
  }
  return { approved };
}

function revalidateAll() {
  revalidatePath("/company");
  revalidatePath("/company/roster");
  revalidatePath("/company/calendar");
  revalidatePath("/company/payroll");
  revalidatePath("/company/invoices");
}

function errorResult(error: unknown) {
  if (error instanceof AllowanceError) return { status: "error" as const, reason: error.message };
  if (error instanceof Error) return { status: "error" as const, reason: ENTRY_ERROR_LABEL[error.message] ?? "入力できませんでした" };
  throw error;
}

// 未提出の勤務を、会社が代わりに入力する
export async function enterWorkReportByCompanyAction(shiftId: string, input: CompanyEntryInput) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  try {
    const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId }, select: { teamId: true } });
    if (!canManageShifts(membership, shift.teamId)) throw new Error("forbidden");
    const result = await enterForShift(shiftId, input, userId, membership.companyId);
    revalidateAll();
    return { status: "ok" as const, ...result };
  } catch (e) {
    return errorResult(e);
  }
}

// まとめて入力（過去分の取り込み）。1件ずつ入れ、うまくいかなかった日を返す
export async function enterWorkReportsByCompanyAction(items: { shiftId: string; input: CompanyEntryInput }[]) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const failed: { shiftId: string; reason: string }[] = [];
  let pendingClient = 0;
  for (const item of items) {
    try {
      const shift = await prisma.shift.findUniqueOrThrow({ where: { id: item.shiftId }, select: { teamId: true } });
      if (!canManageShifts(membership, shift.teamId)) throw new Error("forbidden");
      const r = await enterForShift(item.shiftId, item.input, userId, membership.companyId);
      if (!r.approved) pendingClient += 1;
    } catch (e) {
      failed.push({ shiftId: item.shiftId, reason: e instanceof Error ? (ENTRY_ERROR_LABEL[e.message] ?? "入力できませんでした") : "入力できませんでした" });
    }
  }
  revalidateAll();
  return { failed, pendingClient };
}

// 代わりに入力する時の、最初から入れておく値と業務内容の候補
export async function getCompanyEntryOptionsAction(shiftId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
  if (shift.companyId !== membership.companyId || !canManageShifts(membership, shift.teamId)) throw new Error("forbidden");
  const [map, allowanceOptions, allowancesByShift] = await Promise.all([
    listTaskNamesByWorkplace([shift.companyId], shift.staffUserId),
    listAllowances(shift.companyId),
    listShiftAllowances([shift.id]),
  ]);
  return {
    startTime: shift.startTime,
    endTime: shift.endTime,
    taskName: shift.taskName,
    taskOptions: taskNamesForWorkplace(map, shift.companyId, shift.companyRelationshipId),
    allowanceOptions,
    allowances: allowancesByShift.get(shift.id) ?? [],
  };
}

// 「過去の勤務を追加」の勤務先と、勤務先ごとの業務内容
export async function getPastWorkOptionsAction(staffUserId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageAny(membership, await getStaffTeamIds(staffUserId))) throw new Error("forbidden");
  const [clients, map, placements] = await Promise.all([
    listClients(membership.companyId),
    listTaskNamesByWorkplace([membership.companyId], staffUserId),
    prisma.staffPlacement.findMany({ where: { staffUserId, active: true }, select: { companyRelationshipId: true } }),
  ]);
  // 配属されている勤務先を上に並べ、最初はその先頭を選んでおく
  const placedIds = new Set(placements.map((p) => p.companyRelationshipId));
  const named = clients.map((c) => ({ id: c.id, name: c.clientCompany?.name ?? c.proxyName ?? "(名称未設定)", placed: placedIds.has(c.id) }));
  const workplaces = [
    ...named.filter((w) => w.placed),
    { id: "", name: "社内", placed: false },
    ...named.filter((w) => !w.placed),
  ];
  return {
    workplaces,
    allowanceOptions: await listAllowances(membership.companyId),
    taskNamesByWorkplace: Object.fromEntries(
      workplaces.map((w) => [w.id, taskNamesForWorkplace(map, membership.companyId, w.id || null)]),
    ) as Record<string, string[]>,
  };
}

// シフトが無い過去の勤務を追加する（シフトと承認済みの業務報告を一度に作る）
export async function addPastWorkByCompanyAction(input: {
  staffUserId: string;
  date: string; // YYYY-MM-DD
  companyRelationshipId: string | null;
  taskName: string | null;
  clockIn: string;
  clockOut: string;
  breakMinutes: number;
  allowances?: ShiftAllowanceInput[];
}) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  try {
    const teamIds = await getStaffTeamIds(input.staffUserId);
    if (!canManageAny(membership, teamIds)) throw new Error("forbidden");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("invalid_date");
    if (input.date > todayJst()) throw new Error("future_date");
    const staffMember = await prisma.companyMembership.findFirst({
      where: { userId: input.staffUserId, companyId: membership.companyId },
      select: { id: true },
    });
    if (!staffMember) throw new Error("forbidden");
    if (input.companyRelationshipId) {
      const rel = await prisma.companyRelationship.findFirst({
        where: { id: input.companyRelationshipId, ownerCompanyId: membership.companyId },
        select: { id: true },
      });
      if (!rel) throw new Error("forbidden");
    }
    if (!TIME.test(input.clockIn) || !TIME.test(input.clockOut) || input.clockIn === input.clockOut) throw new Error("clock_in_out_required");
    const shift = await prisma.shift.create({
      data: {
        companyId: membership.companyId,
        teamId: teamIds[0] ?? null,
        staffUserId: input.staffUserId,
        source: input.companyRelationshipId ? "CLIENT" : "INHOUSE",
        companyRelationshipId: input.companyRelationshipId,
        taskName: input.taskName?.trim() || null,
        date: new Date(`${input.date}T00:00:00.000Z`),
        startTime: input.clockIn,
        endTime: input.clockOut,
        status: "CONFIRMED",
        createdVia: "ASSIGN",
        createdByCompanyId: membership.companyId,
      },
    });
    let result: { approved: boolean };
    try {
      result = await enterForShift(
        shift.id,
        {
          outcome: "WORKED",
          clockIn: input.clockIn,
          clockOut: input.clockOut,
          breakMinutes: input.breakMinutes,
          taskName: input.taskName,
          allowances: input.allowances,
        },
        userId,
        membership.companyId,
      );
    } catch (e) {
      // 入力できなかった時は、作ったシフトを残さない
      await prisma.workReport.deleteMany({ where: { shiftId: shift.id } });
      await prisma.shift.delete({ where: { id: shift.id } });
      throw e;
    }
    revalidateAll();
    return { status: "ok" as const, ...result };
  } catch (e) {
    return errorResult(e);
  }
}
