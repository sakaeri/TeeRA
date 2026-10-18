import "server-only";
import { prisma } from "@/lib/prisma";
import type { CancelPolicy, CancelStaffHandling, Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type CancelRule = {
  cancelPolicy: CancelPolicy;
  cancelDeadlineDaysBefore: number | null;
  cancelDeadlineTime: string | null;
  cancelFeeAmount: number | null;
  cancelStaffHandling: CancelStaffHandling;
};

// 締切 =「勤務日のN日前のHH:MM（JST）」。0日前は勤務日当日。
export function cancelDeadline(shiftDate: Date, rule: CancelRule): Date | null {
  if (rule.cancelDeadlineDaysBefore == null || !rule.cancelDeadlineTime) return null;
  const [h, m] = rule.cancelDeadlineTime.split(":").map(Number);
  const day = new Date(shiftDate.getTime() - rule.cancelDeadlineDaysBefore * 24 * 60 * 60 * 1000);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m) - JST_OFFSET_MS);
}

export function describeCancelRule(rule: CancelRule): string {
  const handling = rule.cancelStaffHandling === "HOLD" ? "取消時は調整中" : "取消時は休み";
  return `${describeCancelPolicy(rule)}（${handling}）`;
}

function describeCancelPolicy(rule: CancelRule): string {
  const deadline =
    rule.cancelDeadlineDaysBefore != null && rule.cancelDeadlineTime
      ? `${rule.cancelDeadlineDaysBefore === 0 ? "当日" : `${rule.cancelDeadlineDaysBefore}日前`}${rule.cancelDeadlineTime}`
      : "締切未設定";
  switch (rule.cancelPolicy) {
    case "FREE":
      return "キャンセル自由";
    case "FEE_AFTER_DEADLINE":
      return `${deadline}以降はキャンセル料${rule.cancelFeeAmount ?? 0}円/人`;
    case "DENY_AFTER_DEADLINE":
      return `${deadline}以降はキャンセル不可`;
    case "NOT_ALLOWED":
      return "キャンセル不可";
  }
}

export type CancelEvaluation =
  | { kind: "free" }
  | { kind: "fee"; amount: number; deadline: Date | null }
  | { kind: "blocked"; deadline: Date | null };

// その時点で取り消した場合の扱い。締切が未設定の「締切後〜」は、締切を
// 判定できないため安全側（締切を過ぎた扱い）に倒す。
export function evaluateCancellation(shiftDate: Date, rule: CancelRule | null, now = new Date()): CancelEvaluation {
  if (!rule || rule.cancelPolicy === "FREE") return { kind: "free" };
  if (rule.cancelPolicy === "NOT_ALLOWED") return { kind: "blocked", deadline: null };
  const deadline = cancelDeadline(shiftDate, rule);
  const pastDeadline = !deadline || now.getTime() >= deadline.getTime();
  if (!pastDeadline) return { kind: "free" };
  if (rule.cancelPolicy === "DENY_AFTER_DEADLINE") return { kind: "blocked", deadline };
  const amount = rule.cancelFeeAmount ?? 0;
  return amount > 0 ? { kind: "fee", amount, deadline } : { kind: "free" };
}

export type RecruitmentCancelImpact = {
  shiftId: string;
  staffUserId: string;
  staffName: string;
  agencyCompanyId: string;
  agencyName: string;
  date: Date;
  taskName: string | null;
  evaluation: CancelEvaluation;
  // 規定が無い依頼主・業務内容は、自社で振り替えを判断できるよう調整中にする
  staffHandling: CancelStaffHandling;
};

// 依頼主が自分のオーダーを取り消した時に、派遣元（別会社）のスタッフの
// シフトがどう扱われるか。規定は派遣元がその依頼主×業務内容の単価欄で
// 設定したもの（CompanyPlacementRate）を使う。自社スタッフのシフトは対象外。
export async function listRecruitmentCancelImpacts(
  client: Tx | typeof prisma,
  recruitmentId: string,
  now = new Date(),
): Promise<RecruitmentCancelImpact[]> {
  const recruitment = await client.publicRecruitment.findUniqueOrThrow({ where: { id: recruitmentId } });
  const entries = await client.recruitmentEntry.findMany({
    where: { publicRecruitmentId: recruitmentId, status: { not: "REJECTED" }, resultingShiftId: { not: null } },
  });
  const shiftIds = entries.map((e) => e.resultingShiftId!).filter(Boolean);
  if (shiftIds.length === 0) return [];
  const shifts = await client.shift.findMany({
    where: { id: { in: shiftIds }, status: "CONFIRMED", companyId: { not: recruitment.companyId } },
    include: { staff: true, company: true },
  });

  const impacts: RecruitmentCancelImpact[] = [];
  for (const s of shifts) {
    const rule =
      s.companyRelationshipId && s.taskName
        ? await client.companyPlacementRate.findFirst({
            where: { companyId: s.companyId, companyRelationshipId: s.companyRelationshipId, taskName: s.taskName },
          })
        : null;
    impacts.push({
      shiftId: s.id,
      staffUserId: s.staffUserId,
      staffName: s.staff.name,
      agencyCompanyId: s.companyId,
      agencyName: s.company.name,
      date: s.date,
      taskName: s.taskName,
      evaluation: evaluateCancellation(s.date, rule, now),
      staffHandling: rule?.cancelStaffHandling ?? "HOLD",
    });
  }
  return impacts;
}

// 自社の管理者が依頼主の現場のシフトを解除する時（電話で取り消しを受けた等）
// の確認用。規定から計算したキャンセル料の目安と、既定のスタッフの扱いを返す。
export async function previewShiftCancellation(shiftId: string, now = new Date()) {
  const shift = await prisma.shift.findUniqueOrThrow({
    where: { id: shiftId },
    include: { cancellation: true, companyRelationship: { include: { clientCompany: true } } },
  });
  const rule =
    shift.source === "CLIENT" && shift.companyRelationshipId && shift.taskName
      ? await prisma.companyPlacementRate.findFirst({
          where: { companyId: shift.companyId, companyRelationshipId: shift.companyRelationshipId, taskName: shift.taskName },
        })
      : null;
  const evaluation = evaluateCancellation(shift.date, rule, now);
  return {
    shift,
    isClientShift: shift.source === "CLIENT",
    clientName: shift.companyRelationship?.clientCompany?.name ?? shift.companyRelationship?.proxyName ?? null,
    ruleLabel: rule ? describeCancelRule(rule) : null,
    evaluation,
    defaultStaffHandling: rule?.cancelStaffHandling ?? ("HOLD" as CancelStaffHandling),
  };
}
