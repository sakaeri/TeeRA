import "server-only";
import { prisma } from "@/lib/prisma";
import type { TeamRole } from "@/generated/prisma/enums";

export async function listTeams(companyId: string) {
  return prisma.team.findMany({
    where: { companyId },
    include: { memberships: { include: { user: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function createTeam(params: { companyId: string; name: string }) {
  return prisma.team.create({ data: { companyId: params.companyId, name: params.name } });
}

export async function setTeamMemberRole(params: {
  teamId: string;
  userId: string;
  role: TeamRole;
}) {
  return prisma.teamMembership.upsert({
    where: { teamId_userId: { teamId: params.teamId, userId: params.userId } },
    create: { teamId: params.teamId, userId: params.userId, role: params.role },
    update: { role: params.role },
  });
}

export async function removeTeamMember(params: { teamId: string; userId: string }) {
  return prisma.teamMembership.delete({
    where: { teamId_userId: { teamId: params.teamId, userId: params.userId } },
  });
}

export async function setCompanyMemberRole(params: {
  companyId: string;
  userId: string;
  role: "COMPANY_ADMIN" | "COMPANY_EDITOR";
}) {
  return prisma.companyMembership.updateMany({
    where: { companyId: params.companyId, userId: params.userId },
    data: { role: params.role },
  });
}
