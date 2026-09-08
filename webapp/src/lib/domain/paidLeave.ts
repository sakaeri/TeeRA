import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

// 有給休暇の繰越管理。法定の付与日数表（勤続年数・出勤率に応じた自動計算）
// はアプリでは判定しない方針（他の法律要件と同じ — 開発指示書参照）。
// 代わりに、管理者が付与のたびに日数を手入力し、残日数・次回付与予定日を
// CompanyMembershipに記録して月をまたいでも繰り越されるようにする。

export async function getPaidLeaveInfo(membershipId: string) {
  const membership = await prisma.companyMembership.findUniqueOrThrow({
    where: { id: membershipId },
    select: { hireDate: true, paidLeaveBalance: true, nextPaidLeaveGrantDate: true },
  });
  const events = await prisma.paidLeaveEvent.findMany({
    where: { membershipId },
    include: { createdBy: true },
    orderBy: { createdAt: "desc" },
  });
  return {
    hireDate: membership.hireDate,
    balance: membership.paidLeaveBalance,
    nextGrantDate: membership.nextPaidLeaveGrantDate,
    events,
  };
}

export async function setHireDate(membershipId: string, hireDate: Date | null) {
  return prisma.companyMembership.update({ where: { id: membershipId }, data: { hireDate } });
}

// 付与: 残日数を増やし、次回付与予定日を更新する。日数・次回予定日とも
// 管理者の入力値をそのまま使う（法定表からの自動算出はしない）。
export async function grantPaidLeave(params: {
  membershipId: string;
  days: number;
  nextGrantDate: Date | null;
  createdByUserId: string;
  note?: string;
}) {
  if (params.days <= 0) throw new Error("invalid_days");
  return prisma.$transaction(async (tx) => {
    const membership = await tx.companyMembership.findUniqueOrThrow({ where: { id: params.membershipId } });
    const balanceAfter = membership.paidLeaveBalance + params.days;
    await tx.companyMembership.update({
      where: { id: params.membershipId },
      data: { paidLeaveBalance: balanceAfter, nextPaidLeaveGrantDate: params.nextGrantDate },
    });
    return tx.paidLeaveEvent.create({
      data: {
        membershipId: params.membershipId,
        type: "GRANT",
        days: params.days,
        balanceAfter,
        note: params.note,
        createdByUserId: params.createdByUserId,
      },
    });
  });
}

// 手動訂正（入力ミスの是正など）。増減どちらもあり得るのでdeltaの符号は
// 呼び出し側が決める。
export async function adjustPaidLeaveBalance(params: {
  membershipId: string;
  delta: number;
  createdByUserId: string;
  note?: string;
}) {
  if (params.delta === 0) return null;
  return prisma.$transaction(async (tx) => {
    const membership = await tx.companyMembership.findUniqueOrThrow({ where: { id: params.membershipId } });
    const balanceAfter = membership.paidLeaveBalance + params.delta;
    await tx.companyMembership.update({
      where: { id: params.membershipId },
      data: { paidLeaveBalance: balanceAfter },
    });
    return tx.paidLeaveEvent.create({
      data: {
        membershipId: params.membershipId,
        type: "ADJUST",
        days: params.delta,
        balanceAfter,
        note: params.note,
        createdByUserId: params.createdByUserId,
      },
    });
  });
}

// 給料明細での使用日数の変更を、残日数に反映する（USEイベント）。
// deltaDays（新しい使用日数−前の使用日数）分だけ残日数を減らす — 使用日数を
// 減らす方向の修正なら残日数が戻る。呼び出し側（payroll.ts）が
// トランザクション内で使う。
export async function recordPaidLeaveUsageDelta(
  tx: Tx,
  params: { membershipId: string; deltaDays: number; createdByUserId: string; note?: string },
) {
  if (params.deltaDays === 0) return null;
  const membership = await tx.companyMembership.findUniqueOrThrow({ where: { id: params.membershipId } });
  const balanceAfter = membership.paidLeaveBalance - params.deltaDays;
  await tx.companyMembership.update({
    where: { id: params.membershipId },
    data: { paidLeaveBalance: balanceAfter },
  });
  return tx.paidLeaveEvent.create({
    data: {
      membershipId: params.membershipId,
      type: "USE",
      days: -params.deltaDays,
      balanceAfter,
      note: params.note,
      createdByUserId: params.createdByUserId,
    },
  });
}
