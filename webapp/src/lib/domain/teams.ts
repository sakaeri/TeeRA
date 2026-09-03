import "server-only";
import { prisma } from "@/lib/prisma";
import type { TeamRole } from "@/generated/prisma/enums";

export async function listTeams(companyId: string) {
  return prisma.team.findMany({
    where: { companyId },
    include: { memberships: { include: { user: true } }, clientLinks: true },
    orderBy: { createdAt: "asc" },
  });
}

// チームの主な取引先の紐付け。当初はシフト作成時の依頼主選択で上に出す
// ための並び替え専用として作ったが、「チームに所属する企業＝そのチームが
// 主に取引がある企業」という位置づけ通り、請求書のチームスコープ権限判定
// （canManageAny/canViewAny）にもそのまま使う — 別テーブルは持たない。
export async function addTeamClient(params: { teamId: string; companyRelationshipId: string }) {
  return prisma.teamClientRelationship.upsert({
    where: { teamId_companyRelationshipId: { teamId: params.teamId, companyRelationshipId: params.companyRelationshipId } },
    create: { teamId: params.teamId, companyRelationshipId: params.companyRelationshipId },
    update: {},
  });
}

export async function removeTeamClient(params: { teamId: string; companyRelationshipId: string }) {
  return prisma.teamClientRelationship.deleteMany({
    where: { teamId: params.teamId, companyRelationshipId: params.companyRelationshipId },
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

// 給与計算・契約書などのチームスコープ権限判定用 — 対象スタッフが所属する
// チームID一覧（複数チーム所属もあり得る）。
export async function getStaffTeamIds(staffUserId: string) {
  const rows = await prisma.teamMembership.findMany({
    where: { userId: staffUserId },
    select: { teamId: true },
  });
  return rows.map((r) => r.teamId);
}

// 請求書のチームスコープ権限判定用 — 対象取引先が紐づくチームID一覧。
export async function getClientTeamIds(companyRelationshipId: string) {
  const rows = await prisma.teamClientRelationship.findMany({
    where: { companyRelationshipId },
    select: { teamId: true },
  });
  return rows.map((r) => r.teamId);
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
