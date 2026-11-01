import "server-only";
import { prisma } from "@/lib/prisma";
import { loadDashboardData, scopeDashboardDataToTeams, countDashboardAttention } from "@/lib/domain/dashboard";
import { countUnsubmittedReports } from "@/lib/domain/workReports";
import { listMyMissingDocuments } from "@/lib/domain/requiredDocuments";

// ホーム画面に追加したアプリのアイコンに出す数字（対応が必要な件数）。
// ・本部の管理者/編集者：その会社のダッシュボードの件数（会社全体）
// ・チームのマネージャー：自分のチームの分のダッシュボードの件数
// ・スタッフとして：未提出の業務報告・同意待ちの契約書・まだ読んでいないお知らせ・
//   会社が必須にしている未提出の書類（身分証・振込先）
// 管理者兼スタッフ、複数の会社に所属している人は、すべてを足した数字にする。
export async function computeAppBadgeCount(userId: string) {
  const memberships = await prisma.companyMembership.findMany({
    where: { userId },
    select: { companyId: true, role: true },
  });
  const companyIds = memberships.map((m) => m.companyId);
  const teamRoles = await prisma.teamMembership.findMany({
    where: { userId, role: { in: ["TEAM_MANAGER", "TEAM_LEADER"] } },
    select: { teamId: true, role: true, team: { select: { companyId: true } } },
  });

  const managerCounts = await Promise.all(
    memberships.map(async (m) => {
      if (m.role === "COMPANY_ADMIN" || m.role === "COMPANY_EDITOR") {
        return countDashboardAttention(await loadDashboardData(m.companyId));
      }
      const roles = teamRoles.filter((t) => t.team.companyId === m.companyId);
      // リーダーだけの人はダッシュボードを使わない（カレンダーのみ）ので数えない
      if (!roles.some((t) => t.role === "TEAM_MANAGER")) return 0;
      const data = await scopeDashboardDataToTeams(
        await loadDashboardData(m.companyId),
        roles.map((t) => t.teamId),
      );
      return countDashboardAttention(data);
    }),
  );

  const [unsubmittedReports, pendingConsentContracts, unreadNotices, missingDocuments] = await Promise.all([
    companyIds.length > 0 ? countUnsubmittedReports(userId, companyIds) : 0,
    prisma.staffContract.count({ where: { staffUserId: userId, status: "PENDING_CONSENT" } }),
    prisma.staffNotice.count({ where: { staffUserId: userId, readAt: null } }),
    listMyMissingDocuments(userId),
  ]);
  const missingDocumentCount = missingDocuments.reduce((n, d) => n + d.missing.length, 0);

  return (
    managerCounts.reduce((a, b) => a + b, 0) + unsubmittedReports + pendingConsentContracts + unreadNotices + missingDocumentCount
  );
}
