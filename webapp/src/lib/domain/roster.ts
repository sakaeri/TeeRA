import "server-only";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createInvite } from "@/lib/domain/invites";
import { todayJstParts } from "@/lib/date";
import { resolveRateVersion, resolveContractWageVersion } from "@/lib/domain/contracts";

export async function listStaff(companyId: string) {
  const memberships = await prisma.companyMembership.findMany({
    where: { companyId, role: "STAFF" },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  const userIds = memberships.map((m) => m.userId);
  const teamMemberships = await prisma.teamMembership.findMany({
    where: { userId: { in: userIds }, team: { companyId } },
    include: { team: true },
  });

  return memberships.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    isProxy: m.user.isProxy,
    createdAt: m.createdAt,
    teams: teamMemberships
      .filter((tm) => tm.userId === m.userId)
      .map((tm) => ({ teamId: tm.teamId, teamName: tm.team.name, role: tm.role })),
  }));
}

const WAGE_TYPE_LABEL: Record<string, string> = { HOURLY: "時給", DAILY: "日給", MONTHLY: "月給" };
const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  PART_TIME: "アルバイト",
  FIXED_TERM_EMPLOYEE: "契約社員",
  FULL_TIME: "正社員",
  CONTRACTOR: "業務委託",
  DISPATCH_STAFF: "派遣社員",
};

// Roster table summary: 今月稼働 (hours worked this month from approved WORKED
// reports), 現在の単価 (from the staff's active contract), 契約書 status pill.
export async function listStaffWithSummary(companyId: string) {
  const staff = await listStaff(companyId);
  const userIds = staff.map((s) => s.userId);
  if (userIds.length === 0) return staff.map((s) => ({ ...s, monthlyHours: 0, currentRateLabel: "—", contractStatus: "未送付" as const }));

  const today = todayJstParts();
  const start = new Date(Date.UTC(today.year, today.month - 1, 1));
  const end = new Date(Date.UTC(today.year, today.month, 1));

  const [reports, contracts] = await Promise.all([
    prisma.workReport.findMany({
      where: {
        staffUserId: { in: userIds },
        outcome: "WORKED",
        approvalStatus: "APPROVED",
        shift: { date: { gte: start, lt: end } },
      },
    }),
    prisma.staffContract.findMany({
      where: { staffUserId: { in: userIds }, status: { in: ["ACTIVE", "PENDING_CONSENT"] } },
      include: {
        template: { include: { companyRelationship: { include: { clientCompany: true } } } },
        wageVersions: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const now = new Date();
  return staff.map((s) => {
    const hours = reports
      .filter((r) => r.staffUserId === s.userId)
      .reduce((sum, r) => sum + r.computedMinutes / 60, 0);

    const contract = contracts.find((c) => c.staffUserId === s.userId);
    const workplaceName =
      contract?.template.workplaceType === "CLIENT"
        ? contract.template.workplaceNote ??
          contract.template.companyRelationship?.clientCompany?.name ??
          contract.template.companyRelationship?.proxyName ??
          "配属先"
        : "自社";
    const currentWage = contract ? resolveContractWageVersion(contract.wageVersions, now) : null;
    const currentRateLabel =
      contract && currentWage
        ? `${workplaceName}：${WAGE_TYPE_LABEL[contract.template.wageType]}${currentWage.wageAmount}円`
        : "—";
    const contractStatus = contract
      ? contract.status === "ACTIVE"
        ? ("確認済み" as const)
        : ("確認待ち" as const)
      : ("未送付" as const);

    return { ...s, monthlyHours: Math.round(hours * 10) / 10, currentRateLabel, contractStatus };
  });
}

export async function inviteStaff(params: {
  companyId: string;
  createdByUserId: string;
  teamId?: string;
  contractTemplateId?: string;
  contractStartDate?: Date;
}) {
  return createInvite({
    kind: "STAFF",
    companyId: params.companyId,
    createdByUserId: params.createdByUserId,
    teamId: params.teamId,
    contractTemplateId: params.contractTemplateId,
    contractStartDate: params.contractStartDate,
    targetRole: "STAFF",
  });
}

// 仮アカウントを作成: a name-only placeholder staff member with no real
// login yet. Tagged isProxy so it can later be linked to a real account via
// a "本アカウントと連携する" invite (see inviteProxyUpgrade below).
export async function createProxyStaff(params: {
  companyId: string;
  createdByUserId: string;
  name: string;
  teamId?: string;
}) {
  const placeholderEmail = `proxy-${randomBytes(8).toString("hex")}@proxy.teera.internal`;
  const unusablePasswordHash = await bcrypt.hash(randomBytes(24).toString("hex"), 12);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: params.name,
        email: placeholderEmail,
        passwordHash: unusablePasswordHash,
        isProxy: true,
      },
    });
    await tx.companyMembership.create({
      data: { userId: user.id, companyId: params.companyId, role: "STAFF" },
    });
    if (params.teamId) {
      await tx.teamMembership.create({
        data: { userId: user.id, teamId: params.teamId, role: "TEAM_MEMBER" },
      });
    }
    return user;
  });
}

export async function inviteProxyUpgrade(params: {
  proxyUserId: string;
  companyId: string;
  createdByUserId: string;
}) {
  const membership = await prisma.companyMembership.findFirst({
    where: { userId: params.proxyUserId, companyId: params.companyId },
  });
  if (!membership) throw new Error("proxy_membership_not_found");

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  return prisma.inviteToken.create({
    data: {
      token,
      kind: "STAFF",
      companyId: params.companyId,
      targetRole: "STAFF",
      upgradeProxyUserId: params.proxyUserId,
      createdByUserId: params.createdByUserId,
      expiresAt,
    },
  });
}

// スタッフ詳細パネルの稼働履歴タブ: 対象月のシフト×業務報告を日付ごとにまとめる。
export async function getStaffMonthDetail(params: {
  companyId: string;
  userId: string;
  year: number;
  month: number;
}) {
  const membership = await prisma.companyMembership.findFirstOrThrow({
    where: { userId: params.userId, companyId: params.companyId, role: "STAFF" },
    include: { user: true },
  });
  const teamMemberships = await prisma.teamMembership.findMany({
    where: { userId: params.userId, team: { companyId: params.companyId } },
    include: { team: true },
  });

  const start = new Date(Date.UTC(params.year, params.month - 1, 1));
  const end = new Date(Date.UTC(params.year, params.month, 1));

  const shifts = await prisma.shift.findMany({
    where: {
      companyId: params.companyId,
      staffUserId: params.userId,
      date: { gte: start, lt: end },
      status: { notIn: ["SUPERSEDED", "CANCELLED"] },
    },
    include: { workReport: true, companyRelationship: { include: { clientCompany: true } } },
    orderBy: { date: "asc" },
  });

  const hours = shifts.reduce((sum, s) => sum + (s.workReport?.computedMinutes ?? 0) / 60, 0);
  const daysWorked = new Set(shifts.filter((s) => s.workReport).map((s) => s.date.toISOString().slice(0, 10))).size;

  const contracts = await prisma.staffContract.findMany({
    where: { staffUserId: params.userId, template: { companyId: params.companyId } },
    include: {
      template: { include: { companyRelationship: { include: { clientCompany: true } } } },
      wageVersions: { orderBy: { effectiveFrom: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  const taskRates = await prisma.staffTaskRate.findMany({
    where: { companyId: params.companyId, staffUserId: params.userId },
    include: {
      versions: { orderBy: { effectiveFrom: "desc" } },
      companyRelationship: { include: { clientCompany: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const today = new Date();

  return {
    membershipId: membership.id,
    name: membership.user.name,
    isProxy: membership.user.isProxy,
    note: membership.note ?? "",
    teams: teamMemberships.map((tm) => ({ teamId: tm.teamId, teamName: tm.team.name })),
    monthlyHours: Math.round(hours * 10) / 10,
    daysWorked,
    contracts: contracts.map((c) => {
      const currentWage = resolveContractWageVersion(c.wageVersions, today) ?? {
        wageAmount: c.wageAmountSnapshot,
        effectiveFrom: c.contractStartDate ?? c.template.contractStartDate,
      };
      return {
        id: c.id,
        title: c.template.title,
        status: c.status,
        wageType: c.template.wageType,
        wageAmount: currentWage.wageAmount,
        wageLabel: `${WAGE_TYPE_LABEL[c.template.wageType]}${currentWage.wageAmount}円`,
        employmentTypeLabel: EMPLOYMENT_TYPE_LABEL[c.template.employmentType] ?? c.template.employmentType,
        jobDescription: c.template.jobDescription,
        workplaceName:
          c.template.workplaceType === "CLIENT"
            ? c.template.workplaceNote ??
              c.template.companyRelationship?.clientCompany?.name ??
              c.template.companyRelationship?.proxyName ??
              "配属先"
            : "自社",
        contractStartDate: (c.contractStartDate ?? c.template.contractStartDate).toISOString().slice(0, 10),
        wageVersions: c.wageVersions.map((v) => ({
          id: v.id,
          label: `${WAGE_TYPE_LABEL[c.template.wageType]}${v.wageAmount}円`,
          effectiveFrom: v.effectiveFrom.toISOString().slice(0, 10),
        })),
      };
    }),
    taskRates: taskRates.map((r) => {
      const current = resolveRateVersion(r.versions, today);
      return {
        id: r.id,
        taskName: r.taskName,
        companyRelationshipId: r.companyRelationshipId,
        workplaceLabel: r.companyRelationshipId
          ? (r.companyRelationship?.clientCompany?.name ?? r.companyRelationship?.proxyName ?? "取引先")
          : "勤務先問わず",
        currentLabel: current ? `${WAGE_TYPE_LABEL[current.wageType]}${current.amount}円` : "単価未設定",
        versions: r.versions.map((v) => ({
          id: v.id,
          label: v.wageType && v.amount != null ? `${WAGE_TYPE_LABEL[v.wageType]}${v.amount}円` : "単価未設定（終了）",
          effectiveFrom: v.effectiveFrom.toISOString().slice(0, 10),
        })),
      };
    }),
    days: shifts.map((s) => ({
      shiftId: s.id,
      date: s.date.toISOString().slice(0, 10),
      startTime: s.startTime,
      endTime: s.endTime,
      isAllDay: s.isAllDay,
      isUndecided: s.isUndecided,
      approvalStatus: s.workReport?.approvalStatus ?? null,
      outcome: s.workReport?.outcome ?? null,
      taskName: s.workReport?.taskName ?? s.taskName,
      workplaceLabel:
        s.source === "INHOUSE"
          ? "自社"
          : (s.companyRelationship?.clientCompany?.name ?? s.companyRelationship?.proxyName ?? "取引先"),
    })),
  };
}

export async function updateStaffNote(params: { membershipId: string; note: string }) {
  return prisma.companyMembership.update({
    where: { id: params.membershipId },
    data: { note: params.note.trim() || null },
  });
}
