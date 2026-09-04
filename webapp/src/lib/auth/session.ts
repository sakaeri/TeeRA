import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { CompanyRole } from "@/generated/prisma/enums";
import { hasAnyTeamManagementRole } from "@/lib/auth/permissions";

export const verifySession = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return { userId: session.user.id };
});

export const getCurrentUser = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) return null;
  return prisma.user.findUnique({ where: { id: session.user.id } });
});

export type ActiveMembership = {
  companyId: string;
  companyName: string;
  role: CompanyRole;
  teamMemberships: { teamId: string; teamName: string; role: string }[];
};

// v1 supports exactly one active company relationship per login (the
// multi-employer / multi-role case was explicitly deferred during design —
// see chat27's "斎藤ゆうきさん" discussion). If a user somehow accumulates
// more than one CompanyMembership row, the most recently created one wins.
export const getActiveMembership = cache(
  async (userId: string): Promise<ActiveMembership | null> => {
    const membership = await prisma.companyMembership.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { company: true },
    });
    if (!membership) return null;

    const teamMemberships = await prisma.teamMembership.findMany({
      where: { userId, team: { companyId: membership.companyId } },
      include: { team: true },
    });

    return {
      companyId: membership.companyId,
      companyName: membership.company.name,
      role: membership.role,
      teamMemberships: teamMemberships.map((tm) => ({
        teamId: tm.teamId,
        teamName: tm.team.name,
        role: tm.role,
      })),
    };
  },
);

export async function requireActiveMembership() {
  const { userId } = await verifySession();
  const membership = await getActiveMembership(userId);
  if (!membership) {
    redirect("/register/company");
  }
  return { userId, membership };
}

export async function requireCompanyStaffRole() {
  const { userId, membership } = await requireActiveMembership();
  if (membership.role !== "STAFF") {
    redirect("/company");
  }
  return { userId, membership };
}

// 会社側の管理画面（/company/*）に入れるかどうかの入口ゲート。会社スコープの
// 管理者/編集者に加えて、チームマネージャー/リーダー（会社スコープ上は
// role=STAFFのまま、TeamMembership側の役職として持つ）も通す。関数名は元の
// 「本部管理者/編集者のみ」時代のまま残しているが、実際にどの操作ができる
// かは各画面・各アクション側のcanManage/canManageShifts/canManageCompanySettings
// が個別に判定する（会社スコープ限定の操作はそちらで引き続き弾かれる）。
export async function requireCompanyAdminOrEditor() {
  const { userId, membership } = await requireActiveMembership();
  if (membership.role === "STAFF" && !hasAnyTeamManagementRole(membership)) {
    redirect("/staff");
  }
  return { userId, membership };
}
