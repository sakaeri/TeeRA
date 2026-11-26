"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManageShifts, isCompanyScopeAdmin } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import {
  AllowanceError,
  createAllowance,
  listAllowances,
  setAllowanceArchived,
  setShiftAllowances,
  updateAllowance,
  type AllowanceInput,
  type ShiftAllowanceInput,
} from "@/lib/domain/allowances";

// 手当の登録・変更は本部だけ（会社全体で使う名前と金額のため）
async function requireAllowanceAdmin() {
  const ctx = await requireCompanyAdminOrEditor();
  if (!isCompanyScopeAdmin(ctx.membership)) throw new Error("forbidden");
  return ctx;
}

function result(fn: () => Promise<unknown>) {
  return fn()
    .then(() => {
      revalidatePath("/company/settings");
      return { status: "ok" as const };
    })
    .catch((e) => {
      if (e instanceof AllowanceError) return { status: "error" as const, reason: e.message };
      throw e;
    });
}

export async function createAllowanceAction(input: AllowanceInput) {
  const { membership } = await requireAllowanceAdmin();
  return result(() => createAllowance(membership.companyId, input));
}

export async function updateAllowanceAction(allowanceId: string, input: AllowanceInput) {
  const { membership } = await requireAllowanceAdmin();
  return result(() => updateAllowance(membership.companyId, String(allowanceId), input));
}

export async function setAllowanceArchivedAction(allowanceId: string, archived: boolean) {
  const { membership } = await requireAllowanceAdmin();
  return result(() => setAllowanceArchived(membership.companyId, String(allowanceId), Boolean(archived)));
}

// 勤務に付ける手当の候補（しまっていないもの）
export async function listAllowanceOptionsAction() {
  const { membership } = await requireCompanyAdminOrEditor();
  return listAllowances(membership.companyId);
}

// 会社が勤務の手当を付け直す（業務報告の詳細・代わりに入力など）
export async function setShiftAllowancesAction(shiftId: string, items: ShiftAllowanceInput[]) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const shift = await prisma.shift.findUniqueOrThrow({ where: { id: String(shiftId) }, select: { companyId: true, teamId: true } });
  if (shift.companyId !== membership.companyId || !canManageShifts(membership, shift.teamId)) throw new Error("forbidden");
  try {
    await setShiftAllowances({ shiftId: String(shiftId), items, actorUserId: userId });
  } catch (e) {
    if (e instanceof AllowanceError) return { status: "error" as const, reason: e.message };
    throw e;
  }
  revalidatePath("/company");
  revalidatePath("/company/roster");
  revalidatePath("/company/payroll");
  revalidatePath("/company/invoices");
  return { status: "ok" as const };
}
