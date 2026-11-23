import { requireCompanyAdminOrEditor, listMyMemberships } from "@/lib/auth/session";
import { hasAnyTeamManagementRole, isCompanyScopeAdmin, isLeaderOnly, myManagedOrLedTeamIds } from "@/lib/auth/permissions";
import { countSubmittedStaffInvoices } from "@/lib/domain/dashboard";
import { prisma } from "@/lib/prisma";
import { WeekStartProvider } from "@/components/week/WeekStart";
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
  const leaderOnly = isLeaderOnly(membership);
  const [company, user, myMemberships, pendingStaffInvoiceCount] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    listMyMemberships(userId),
    // 給与/請求のメニューに出す、届いて確認待ちの請求書の数（リーダーは給与/請求を開けないので数えない）
    leaderOnly
      ? 0
      : countSubmittedStaffInvoices(
          membership.companyId,
          isCompanyScopeAdmin(membership) ? null : myManagedOrLedTeamIds(membership),
        ),
  ]);

  return (
    <CompanyShell
      companyName={company.name}
      userName={user.name}
      userEmail={user.email}
      roleLabel={resolveRoleLabel(membership)}
      teeBalance={company.teeBalance}
      hasMultipleCompanies={myMemberships.length > 1}
      showStaffScreenLink={membership.canWorkShifts || hasAnyTeamManagementRole(membership)}
      leaderOnly={leaderOnly}
      navBadges={{ "/company/payroll": pendingStaffInvoiceCount }}
    >
      <WeekStartProvider mondayFirst={user.weekStartsMonday}>{children}</WeekStartProvider>
    </CompanyShell>
  );
}
