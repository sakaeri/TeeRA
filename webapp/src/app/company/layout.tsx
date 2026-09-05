import { requireCompanyAdminOrEditor, listMyMemberships } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { CompanyShell } from "@/components/company/CompanyShell";

const ROLE_LABEL: Record<string, string> = {
  COMPANY_ADMIN: "本部：管理者として表示",
  COMPANY_EDITOR: "本部：編集者として表示",
};

const TEAM_ROLE_LABEL: Record<string, string> = {
  TEAM_MANAGER: "マネージャー",
  TEAM_LEADER: "リーダー",
};

function resolveRoleLabel(membership: Awaited<ReturnType<typeof requireCompanyAdminOrEditor>>["membership"]) {
  const companyLabel = ROLE_LABEL[membership.role];
  if (companyLabel) return companyLabel;
  // 会社スコープの役職を持たない（role=STAFF）が、チームマネージャー/
  // リーダーとして会社側の管理画面に入ってきたケース。
  const teamRole = membership.teamMemberships.find((tm) => tm.role === "TEAM_MANAGER" || tm.role === "TEAM_LEADER");
  if (teamRole) return `${teamRole.teamName}：${TEAM_ROLE_LABEL[teamRole.role] ?? teamRole.role}として表示`;
  return membership.role;
}

export default async function CompanyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const [company, user, myMemberships] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    listMyMemberships(userId),
  ]);

  return (
    <CompanyShell
      companyName={company.name}
      userName={user.name}
      userEmail={user.email}
      roleLabel={resolveRoleLabel(membership)}
      teeBalance={company.teeBalance}
      hasMultipleCompanies={myMemberships.length > 1}
      canWorkShifts={membership.canWorkShifts}
    >
      {children}
    </CompanyShell>
  );
}
