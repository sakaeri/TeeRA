import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { todayJst } from "@/lib/date";

type Tx = Prisma.TransactionClient;

// ダッシュボードの「有給付与」アラート: 次回付与予定日が「今日〜10日後」に
// 入っているスタッフ（見出しとして事前に気づけるように）。契約満了アラート
// と違い、予定日を過ぎても対象から外さない — 付与し忘れは労基法上のリスク
// があるため、放置していれば自然に消える契約満了とは扱いを変えている。
// 実際に消えるのは付与する（grantPaidLeave）か見送る（skipPaidLeaveGrant）
// のどちらかを行ったときだけ。
const PAID_LEAVE_GRANT_ALERT_WINDOW_DAYS = 10;

export async function listDuePaidLeaveGrants(companyId: string) {
  const horizon = new Date(`${todayJst()}T00:00:00.000Z`);
  horizon.setUTCDate(horizon.getUTCDate() + PAID_LEAVE_GRANT_ALERT_WINDOW_DAYS);

  const memberships = await prisma.companyMembership.findMany({
    where: { companyId, nextPaidLeaveGrantDate: { lte: horizon } },
    include: { user: true },
    orderBy: { nextPaidLeaveGrantDate: "asc" },
  });
  return memberships.map((m) => ({
    membershipId: m.id,
    staffUserId: m.userId,
    staffName: m.user.name,
    nextGrantDate: m.nextPaidLeaveGrantDate!.toISOString().slice(0, 10),
  }));
}

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

// 入社日を保存する。まだ一度も付与していない（GRANTイベントが無い）場合は、
// 次回付与予定日を「入社から6ヶ月後」に自動セットする（労基法上の原則的な
// 初回付与時期）。既に付与履歴があるスタッフの予定日は上書きしない —
// 契約が一度切れて再度入社したスタッフなど、通常のサイクルに当てはまらない
// ケースは手動（付与時の次回予定日欄）で個別に調整してもらう。
export async function setHireDate(membershipId: string, hireDate: Date | null) {
  const hasGranted = await prisma.paidLeaveEvent.findFirst({ where: { membershipId, type: "GRANT" } });
  const data: { hireDate: Date | null; nextPaidLeaveGrantDate?: Date } = { hireDate };
  if (hireDate && !hasGranted) {
    const firstGrantDate = new Date(hireDate);
    firstGrantDate.setUTCMonth(firstGrantDate.getUTCMonth() + 6);
    data.nextPaidLeaveGrantDate = firstGrantDate;
  }
  return prisma.companyMembership.update({ where: { id: membershipId }, data });
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

// 付与予定日を迎えたが今回は見送る（ダッシュボードの「有給付与」アラートの
// 「付与しない」ボタンから呼ばれる）。次回予定日は自動では再設定しない
// （nullにする）— この時点で見送るということは、退職済み・契約終了・
// 対象外になったなどの理由がほとんどで、1年後にまた自動で思い出させる
// 必要は無いという判断。引き続きこのスタッフの有給休暇を追跡したくなった
// 場合は、管理者が改めて「付与する」から手動で次回予定日を設定し直す。
export async function skipPaidLeaveGrant(params: { membershipId: string; createdByUserId: string; note?: string }) {
  return prisma.$transaction(async (tx) => {
    const membership = await tx.companyMembership.findUniqueOrThrow({ where: { id: params.membershipId } });
    if (!membership.nextPaidLeaveGrantDate) throw new Error("no_pending_grant");
    const skippedDate = membership.nextPaidLeaveGrantDate.toISOString().slice(0, 10);
    await tx.companyMembership.update({
      where: { id: params.membershipId },
      data: { nextPaidLeaveGrantDate: null },
    });
    return tx.paidLeaveEvent.create({
      data: {
        membershipId: params.membershipId,
        type: "SKIP",
        days: 0,
        balanceAfter: membership.paidLeaveBalance,
        note: params.note ?? `${skippedDate}の付与を見送り、次回予定日をクリア`,
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
